import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { LockNotAcquiredError, RedisLock } from '../common/redis-lock';
import { ProblemException } from '../common/errors/problem.exception';
import { TokenCipherService } from '../crypto/token-cipher.service';
import { type Database, DRIZZLE } from '../db/db.module';
import { channels } from '../db/schema';
import { NotifyService } from '../notifications/notify.service';
import {
  type ProviderContext,
  ProviderRegistry,
  ReauthRequired,
  RetryableProviderError,
  type SocialProvider,
  type TokenSet,
} from '../providers';
import { type ChannelRow, decryptTokens, encryptTokens } from './channel-tokens';
import { type ChannelView } from './channels.dto';
import { toChannelView } from './channels.service';

/** Tokens that expire sooner than this are refreshed before use. */
export const REFRESH_WINDOW_MS = 5 * 60 * 1000;
/** Safety TTL of the per-channel refresh lock; a refresh is a single HTTP call. */
const REFRESH_LOCK_TTL_MS = 60_000;
/** How long a caller waits for a refresh that another worker is already doing. */
const REFRESH_LOCK_WAIT_MS = 30_000;

/** What the publish worker and the metrics job need to talk to a network as a channel. */
export interface ValidChannelContext {
  /** Valid (refreshed if needed) tokens plus the account, ready for every adapter call. */
  context: ProviderContext;
  adapter: SocialProvider;
  /** The channel without any secret (settings, handle, status, ...). */
  channel: ChannelView;
}

export function refreshLockName(channelId: string): string {
  return `channel-refresh:${channelId}`;
}

/**
 * Hands out usable provider credentials for a channel and keeps them fresh.
 * Used by the publish worker (T024) and the metrics job.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly cipher: TokenCipherService,
    private readonly registry: ProviderRegistry,
    private readonly lock: RedisLock,
    private readonly notify: NotifyService,
  ) {}

  /**
   * Returns a provider context with an access token valid for at least the next 5 minutes.
   *
   * - Refreshes under the lock `channel-refresh:<id>` when the token expires within 5 minutes.
   *   The row is re-read after taking the lock (another worker may have refreshed already)
   *   and the rotated set is persisted (X rotates refresh tokens).
   * - Throws {@link ReauthRequired} when the owner must reconnect: the refresh was
   *   rejected, there is no refresh token, or the channel is already `needs_reconnect` /
   *   `disconnected`. The first time it happens the channel moves to `needs_reconnect`
   *   and a `channel_reauth` notification is raised (once per transition).
   * - Throws {@link RetryableProviderError} for transient failures (network, 5xx, lock
   *   timeout); anything else the adapter throws is passed through.
   * - Throws a 404 problem when the channel does not exist and a 409
   *   CHANNEL_NOT_CONFIGURED problem when the provider's env credentials were removed.
   */
  async getValidContext(channelId: string): Promise<ValidChannelContext> {
    const channel = await this.loadUsable(channelId);
    const adapter = this.registry.get(channel.provider);
    const tokens = this.tokensOf(channel);
    if (!needsRefresh(tokens)) return this.build(channel, adapter, tokens);

    try {
      return await this.lock.withLock(
        refreshLockName(channelId),
        REFRESH_LOCK_TTL_MS,
        () => this.refreshLocked(channelId, adapter),
        { waitMs: REFRESH_LOCK_WAIT_MS, retryDelayMs: 50 },
      );
    } catch (err) {
      if (err instanceof LockNotAcquiredError) {
        throw new RetryableProviderError(channel.provider, {
          code: 'REFRESH_LOCK_TIMEOUT',
          message: 'Another process is refreshing this channel token. Try again shortly.',
          cause: err,
        });
      }
      throw err;
    }
  }

  /**
   * Moves a connected channel to `needs_reconnect` and notifies the owner.
   * Atomic and idempotent: only the call that actually performs the transition notifies,
   * so concurrent workers hitting the same revoked token produce one notification.
   * A channel that is already `needs_reconnect` or `disconnected` is left alone.
   *
   * @param reason Human-readable cause, shown in the notification (never include tokens).
   * @param options.postId The post being published when the problem surfaced, if any.
   * @returns true when this call changed the status.
   */
  async markNeedsReconnect(
    channelId: string,
    reason: string,
    options: { postId?: string } = {},
  ): Promise<boolean> {
    const [row] = await this.db
      .update(channels)
      .set({ status: 'needs_reconnect' })
      .where(and(eq(channels.id, channelId), eq(channels.status, 'connected')))
      .returning({ provider: channels.provider, handle: channels.handle });
    if (!row) return false;

    this.logger.warn({ channelId, provider: row.provider, reason }, 'Channel needs reconnect');
    try {
      await this.notify.notify('channel_reauth', {
        provider: row.provider,
        channelHandle: row.handle,
        postId: options.postId,
        reason,
      });
    } catch (err) {
      // The status change is what matters; a failed notification must not hide the cause.
      this.logger.error(
        { channelId, err: err instanceof Error ? err.message : String(err) },
        'Could not raise channel_reauth notification',
      );
    }
    return true;
  }

  private async refreshLocked(
    channelId: string,
    adapter: SocialProvider,
  ): Promise<ValidChannelContext> {
    // Re-read: another worker may have refreshed (or the owner disconnected) while we waited.
    const channel = await this.loadUsable(channelId);
    const current = this.tokensOf(channel);
    if (!needsRefresh(current)) return this.build(channel, adapter, current);

    let next: TokenSet;
    try {
      next = await adapter.refresh(current);
    } catch (err) {
      if (err instanceof ReauthRequired) {
        await this.markNeedsReconnect(channelId, err.message);
      }
      throw err;
    }

    // Always persist the returned set: the old refresh token may no longer work.
    // Never resurrect the tokens of a channel disconnected while the refresh was in flight.
    const [row] = await this.db
      .update(channels)
      .set(encryptTokens(this.cipher, next, channel.scopes))
      .where(and(eq(channels.id, channelId), ne(channels.status, 'disconnected')))
      .returning();
    const saved = row ?? channel;
    return this.build(saved, adapter, next);
  }

  /** Loads the channel and rejects it unless the owner can still publish with it. */
  private async loadUsable(channelId: string): Promise<ChannelRow> {
    const [channel] = await this.db.select().from(channels).where(eq(channels.id, channelId));
    if (!channel) throw ProblemException.notFound('Channel not found');
    if (channel.status !== 'connected') {
      // Already notified when it moved to needs_reconnect, or disconnected on purpose.
      throw new ReauthRequired(channel.provider, {
        code:
          channel.status === 'disconnected' ? 'CHANNEL_DISCONNECTED' : 'CHANNEL_NEEDS_RECONNECT',
        message:
          channel.status === 'disconnected'
            ? `The ${channel.provider} channel was disconnected. Connect it again.`
            : `The ${channel.provider} channel must be reconnected.`,
      });
    }
    return channel;
  }

  private tokensOf(channel: ChannelRow): TokenSet {
    const tokens = decryptTokens(this.cipher, channel);
    if (!tokens) {
      throw new ReauthRequired(channel.provider, {
        code: 'CHANNEL_DISCONNECTED',
        message: `The ${channel.provider} channel has no stored tokens. Connect it again.`,
      });
    }
    return tokens;
  }

  private build(
    channel: ChannelRow,
    adapter: SocialProvider,
    tokens: TokenSet,
  ): ValidChannelContext {
    return {
      context: {
        tokens,
        account: { externalId: channel.externalId, handle: channel.handle },
      },
      adapter,
      channel: toChannelView(channel),
    };
  }
}

function needsRefresh(tokens: TokenSet, now = Date.now()): boolean {
  return tokens.expiresAt !== undefined && tokens.expiresAt.getTime() - now < REFRESH_WINDOW_MS;
}
