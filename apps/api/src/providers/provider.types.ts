import { type ProviderId, type ProviderLimits } from '@omero/shared';

export { type ProviderId, type ProviderLimits };

/** OAuth tokens for one channel, as held in memory (they are encrypted at rest by the channels module). */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** When the access token expires. Absent when the provider did not say. */
  expiresAt?: Date;
  /** When the refresh token expires (LinkedIn programmatic refresh tokens). */
  refreshExpiresAt?: Date;
  scopes: string[];
}

/** PKCE pair (RFC 7636). Only S256 is produced. */
export interface Pkce {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

/** The connected account as seen by the network. Maps to the `channels` row. */
export interface ChannelProfile {
  /** X user id, LinkedIn person id (`sub`). */
  externalId: string;
  /** X username (without @). LinkedIn has no public handle via OIDC, so its full name is used. */
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * The channel an operation runs as. Adapters need more than the token: LinkedIn needs
 * the person URN as post author and image owner, and X needs the handle to build URLs.
 */
export interface ChannelAccount {
  externalId: string;
  handle: string;
}

/** Everything an authenticated provider call needs. */
export interface ProviderContext {
  tokens: TokenSet;
  account: ChannelAccount;
}

/** Raw media bytes ready to upload (already normalized by the media pipeline). */
export interface MediaFile {
  buffer: Buffer;
  mime: string;
  // TODO: alt text once the composer supports it (both networks accept it).
}

/** Media already uploaded to the network (X media id, LinkedIn image URN). */
export interface RemoteMediaRef {
  id: string;
}

/**
 * One item to publish (a single post, or one post of an X thread).
 * Media may be raw files (uploaded by `publishItem`) or refs from an earlier
 * `uploadMedia` call, so the worker can upload once and reuse refs across retries.
 */
export interface PublishItem {
  text: string;
  media: Array<MediaFile | RemoteMediaRef>;
}

/** A published post on the network. */
export interface RemoteRef {
  id: string;
  url: string;
}

/** Metrics for one published post. Fields the network did not return are undefined. */
export interface MetricsSnapshot {
  remoteId: string;
  impressions?: number;
  likes?: number;
  reposts?: number;
  replies?: number;
  quotes?: number;
  bookmarks?: number;
  /** Untouched provider payload for this post. */
  raw: unknown;
}

export type ErrorClass = 'retryable' | 'auth' | 'permanent';

/**
 * One adapter per social network. Adapters are stateless apart from their client
 * credentials; token persistence and refresh locking live in the channels module.
 *
 * Differences from the technical spec's sketch (and why):
 * - Authenticated calls take a {@link ProviderContext} (tokens + account) instead of
 *   only tokens: LinkedIn needs the person URN as author/owner, X needs the handle
 *   to build the post URL.
 * - `getAuthorizationUrl` takes the redirect-free inputs only; the redirect URI is
 *   fixed per provider from PUBLIC_BASE_URL.
 */
export interface SocialProvider {
  readonly id: ProviderId;
  readonly limits: ProviderLimits;
  /** Scopes requested on the consent screen. */
  readonly scopes: readonly string[];

  /** Consent screen URL. Providers that do not support PKCE for web apps ignore `pkce`. */
  getAuthorizationUrl(state: string, pkce: Pkce): URL;
  exchangeCode(code: string, pkce: Pkce): Promise<TokenSet>;
  /** Returns a fresh token set; throws {@link ReauthRequired} when refreshing is impossible. */
  refresh(tokens: TokenSet): Promise<TokenSet>;
  getProfile(tokens: TokenSet): Promise<ChannelProfile>;
  uploadMedia(ctx: ProviderContext, file: MediaFile): Promise<RemoteMediaRef>;
  publishItem(ctx: ProviderContext, item: PublishItem, replyTo?: RemoteRef): Promise<RemoteRef>;
  /** Optional: only networks whose metrics the owner token can read implement it. */
  fetchMetrics?(ctx: ProviderContext, refs: RemoteRef[]): Promise<MetricsSnapshot[]>;
  classifyError(err: unknown): ErrorClass;
}

export function isRemoteMediaRef(media: MediaFile | RemoteMediaRef): media is RemoteMediaRef {
  return !('buffer' in media);
}
