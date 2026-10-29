import { Inject, Injectable, Logger } from '@nestjs/common';
import { type ProviderId } from '@omero/shared';
import { and, asc, eq } from 'drizzle-orm';
import { ProblemException } from '../common/errors/problem.exception';
import { AppConfig } from '../config/app-config';
import { TokenCipherService } from '../crypto/token-cipher.service';
import { type Database, DRIZZLE } from '../db/db.module';
import { channels, deliveries } from '../db/schema';
import {
  type ChannelProfile,
  OAuthStateError,
  OAuthStateStore,
  pkceFromVerifier,
  ProviderError,
  ProviderRegistry,
  type SocialProvider,
  type TokenSet,
} from '../providers';
import { CONNECT_ERROR, type ConnectError, connectErrorFromProvider } from './channel-errors';
import { type ChannelRow, encryptTokens } from './channel-tokens';
import { type ChannelView, type OAuthCallbackQueryDto } from './channels.dto';

/** Where the owner lands after the OAuth round trip. */
export const CHANNELS_SETTINGS_PATH = '/settings/channels';

export function toChannelView(row: ChannelRow): ChannelView {
  return {
    id: row.id,
    provider: row.provider,
    externalId: row.externalId,
    handle: row.handle,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    status: row.status,
    settings: row.settings,
    tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function describeError(err: unknown): string {
  if (err instanceof ProviderError) return `${err.code}${err.status ? ` (${err.status})` : ''}`;
  return err instanceof Error ? err.message : String(err);
}

/** Lists, connects, configures and disconnects channels. Token refresh lives in TokenService. */
@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: AppConfig,
    private readonly cipher: TokenCipherService,
    private readonly registry: ProviderRegistry,
    private readonly stateStore: OAuthStateStore,
  ) {}

  async list(): Promise<ChannelView[]> {
    const rows = await this.db
      .select()
      .from(channels)
      .orderBy(asc(channels.createdAt), asc(channels.id));
    return rows.map(toChannelView);
  }

  async mustGet(id: string): Promise<ChannelRow> {
    const [row] = await this.db.select().from(channels).where(eq(channels.id, id));
    if (!row) throw ProblemException.notFound('Channel not found');
    return row;
  }

  async updateSettings(id: string, settings: ChannelRow['settings']): Promise<ChannelView> {
    const current = await this.mustGet(id);
    const [row] = await this.db
      .update(channels)
      .set({ settings: { ...current.settings, ...settings } })
      .where(eq(channels.id, id))
      .returning();
    return toChannelView(row!);
  }

  /**
   * Disconnects a channel: wipes its tokens and flags its pending deliveries so the
   * calendar can show them. The row stays, so post history keeps its channel.
   * Idempotent. TODO: revoke the tokens at the network as well.
   */
  async disconnect(id: string): Promise<void> {
    await this.mustGet(id);
    await this.db.transaction(async (tx) => {
      await tx
        .update(channels)
        .set({
          status: 'disconnected',
          accessTokenEnc: null,
          refreshTokenEnc: null,
          tokenExpiresAt: null,
          refreshExpiresAt: null,
        })
        .where(eq(channels.id, id));
      await tx
        .update(deliveries)
        .set({ needsAttention: true })
        .where(and(eq(deliveries.channelId, id), eq(deliveries.status, 'pending')));
    });
  }

  /** Step 1 of connecting: the consent screen URL, with state and PKCE stored for the callback. */
  async startConnect(provider: ProviderId, sessionId: string): Promise<string> {
    const adapter = this.registry.get(provider);
    const created = await this.stateStore.create(provider, sessionId, CHANNELS_SETTINGS_PATH);
    return adapter.getAuthorizationUrl(created.state, created.pkce).href;
  }

  /**
   * Step 2 of connecting. Always resolves to an app URL to redirect the browser to:
   * `?connected=<provider>` on success, `?error=<code>` on any failure.
   */
  async completeConnect(
    provider: ProviderId,
    query: OAuthCallbackQueryDto,
    sessionId: string,
  ): Promise<string> {
    let redirectAfter = CHANNELS_SETTINGS_PATH;
    const fail = (code: ConnectError) => this.appUrl(redirectAfter, { error: code });

    try {
      // Consumed first, even when the network reported an error, so a state is single use.
      let codeVerifier: string;
      try {
        const data = await this.stateStore.consume(query.state ?? '', sessionId, provider);
        codeVerifier = data.codeVerifier;
        redirectAfter = data.redirectAfter ?? CHANNELS_SETTINGS_PATH;
      } catch (err) {
        if (!(err instanceof OAuthStateError)) throw err;
        this.logger.warn({ provider, reason: err.reason }, 'OAuth callback with invalid state');
        return fail(
          err.reason === 'unknown_or_expired'
            ? CONNECT_ERROR.stateInvalid
            : CONNECT_ERROR.stateMismatch,
        );
      }

      if (query.error) {
        this.logger.warn({ provider, error: query.error }, 'OAuth consent was not granted');
        return fail(connectErrorFromProvider(query.error));
      }
      if (!query.code) return fail(CONNECT_ERROR.missingCode);

      const adapter = this.registry.find(provider);
      if (!adapter) return fail(CONNECT_ERROR.notConfigured);

      let tokens: TokenSet;
      try {
        tokens = await adapter.exchangeCode(query.code, pkceFromVerifier(codeVerifier));
      } catch (err) {
        this.logger.warn({ provider, err: describeError(err) }, 'OAuth code exchange failed');
        return fail(CONNECT_ERROR.exchangeFailed);
      }

      let profile: ChannelProfile;
      try {
        profile = await adapter.getProfile(tokens);
      } catch (err) {
        this.logger.warn({ provider, err: describeError(err) }, 'OAuth profile fetch failed');
        return fail(CONNECT_ERROR.profileFailed);
      }

      const channel = await this.upsertConnected(adapter, tokens, profile);
      this.logger.log({ provider, channelId: channel.id }, 'Channel connected');
      return this.appUrl(redirectAfter, { connected: provider });
    } catch (err) {
      this.logger.error({ provider, err: describeError(err) }, 'OAuth callback failed');
      return fail(CONNECT_ERROR.unknown);
    }
  }

  /**
   * Creates the channel, or updates it when the same account (provider + external id)
   * is connected again. Settings are kept on reconnect. Pending deliveries that were
   * flagged by a disconnect are released.
   */
  private async upsertConnected(
    adapter: SocialProvider,
    tokens: TokenSet,
    profile: ChannelProfile,
  ): Promise<ChannelRow> {
    const connection = {
      handle: profile.handle,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      status: 'connected' as const,
      ...encryptTokens(this.cipher, tokens, adapter.scopes),
    };
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(channels)
        .values({ provider: adapter.id, externalId: profile.externalId, ...connection })
        .onConflictDoUpdate({
          target: [channels.provider, channels.externalId],
          set: { ...connection, updatedAt: new Date() },
        })
        .returning();
      await tx
        .update(deliveries)
        .set({ needsAttention: false })
        .where(
          and(
            eq(deliveries.channelId, row!.id),
            eq(deliveries.status, 'pending'),
            eq(deliveries.needsAttention, true),
          ),
        );
      return row!;
    });
  }

  /** Builds an absolute URL on PUBLIC_BASE_URL (the web app is served from the same origin). */
  private appUrl(path: string, params: Record<string, string>): string {
    const url = new URL(this.config.env.PUBLIC_BASE_URL.replace(/\/+$/, '') + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.href;
  }
}
