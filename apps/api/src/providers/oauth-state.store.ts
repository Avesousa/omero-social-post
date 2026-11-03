import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { type Pkce, type ProviderId } from './provider.types';

/** How long a user has to finish the consent screen. */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const KEY_PREFIX = 'omero:oauth:state:';

export interface OAuthStateData {
  provider: ProviderId;
  sessionId: string;
  codeVerifier: string;
  /** Relative app path to return to after the callback, e.g. `/settings/channels`. */
  redirectAfter?: string;
  createdAt: string;
}

export interface CreatedOAuthState {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  /** Convenience bundle for `SocialProvider.getAuthorizationUrl`. */
  pkce: Pkce;
}

export type OAuthStateFailure = 'unknown_or_expired' | 'session_mismatch' | 'provider_mismatch';

/** Raised by {@link OAuthStateStore.consume}. The callback should restart the connect flow. */
export class OAuthStateError extends Error {
  constructor(readonly reason: OAuthStateFailure) {
    super(`Invalid OAuth state: ${reason}`);
    this.name = 'OAuthStateError';
  }
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

/** RFC 7636 S256 challenge for a verifier. */
export function pkceChallenge(codeVerifier: string): string {
  return base64url(createHash('sha256').update(codeVerifier).digest());
}

/** Only same-origin relative paths are accepted, so the callback cannot become an open redirect. */
function safeRedirectPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : undefined;
}

/**
 * OAuth `state` + PKCE verifier storage in Redis, bound to the browser session.
 * Each state is single use (atomic GETDEL) and expires after 10 minutes.
 */
@Injectable()
export class OAuthStateStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async create(
    provider: ProviderId,
    sessionId: string,
    redirectAfter?: string,
    ttlSeconds = OAUTH_STATE_TTL_SECONDS,
  ): Promise<CreatedOAuthState> {
    const state = base64url(randomBytes(32));
    // 32 random bytes → 43 base64url chars, within RFC 7636's 43–128 range.
    const codeVerifier = base64url(randomBytes(32));
    const codeChallenge = pkceChallenge(codeVerifier);
    const data: OAuthStateData = {
      provider,
      sessionId,
      codeVerifier,
      redirectAfter: safeRedirectPath(redirectAfter),
      createdAt: new Date().toISOString(),
    };
    await this.redis.set(KEY_PREFIX + state, JSON.stringify(data), 'EX', ttlSeconds);
    return {
      state,
      codeVerifier,
      codeChallenge,
      pkce: { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' },
    };
  }

  /**
   * Returns and deletes the stored data. Throws {@link OAuthStateError} for unknown,
   * expired, already used, or session/provider-mismatched state. A mismatched state
   * is burnt too, so it can never be replayed.
   */
  async consume(state: string, sessionId: string, provider?: ProviderId): Promise<OAuthStateData> {
    if (!state || state.length > 256) throw new OAuthStateError('unknown_or_expired');
    const raw = await this.redis.getdel(KEY_PREFIX + state);
    if (!raw) throw new OAuthStateError('unknown_or_expired');
    let data: OAuthStateData;
    try {
      data = JSON.parse(raw) as OAuthStateData;
    } catch {
      throw new OAuthStateError('unknown_or_expired');
    }
    if (data.sessionId !== sessionId) throw new OAuthStateError('session_mismatch');
    if (provider && data.provider !== provider) throw new OAuthStateError('provider_mismatch');
    return data;
  }
}

/** Builds the PKCE bundle from a stored verifier (for the code exchange in the callback). */
export function pkceFromVerifier(codeVerifier: string): Pkce {
  return { codeVerifier, codeChallenge: pkceChallenge(codeVerifier), codeChallengeMethod: 'S256' };
}
