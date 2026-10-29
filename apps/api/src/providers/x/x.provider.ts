/**
 * X (Twitter) API v2 adapter: OAuth 2.0 Authorization Code + PKCE, v2 media upload,
 * posts, and public metrics.
 *
 * Verified on 2026-10-28/29 against:
 * - https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token
 *   (authorize URL, token URL, Basic auth for confidential clients, refresh request)
 * - https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
 *   (scopes incl. media.write/offline.access, S256, 2 h access tokens, 30 s auth codes)
 * - https://docs.x.com/x-api/media/upload-media (POST /2/media/upload, multipart, media_category)
 * - https://docs.x.com/x-api/media/introduction (simple upload for images; JPG/PNG/GIF/WEBP; 5 MB)
 * - https://docs.x.com/x-api/media/quickstart/best-practices (4 photos per post, 5 MB images)
 * - https://docs.x.com/x-api/posts/create-post (POST /2/tweets, media.media_ids 1–4, reply.in_reply_to_tweet_id, 201)
 * - https://docs.x.com/x-api/posts/manage-tweets/integrate (rate limits; self-serve reply restriction)
 * - https://docs.x.com/x-api/users/get-my-user (GET /2/users/me, user.fields=profile_image_url)
 * - https://docs.x.com/x-api/posts/get-posts-by-ids (GET /2/tweets?ids=, max 100)
 * - https://docs.x.com/x-api/fundamentals/metrics (public_metrics incl. impression_count)
 * - https://docs.x.com/x-api/fundamentals/response-codes-and-errors (status codes, problem types, usage-capped)
 * - https://docs.x.com/fundamentals/rate-limits (x-rate-limit-reset, epoch seconds)
 * - https://docs.x.com/changelog (pay-per-use; reply restriction since 2026-02-23)
 */
import { PROVIDER_LIMITS } from '@omero/shared';
import {
  classifyProviderError,
  PermanentProviderError,
  type ProviderError,
  ReauthRequired,
  RetryableProviderError,
  truncateDetail,
} from '../provider-errors';
import {
  basicAuth,
  chunk,
  expiryFromSeconds,
  parseScopes,
  providerFetch,
  readJson,
  retryAfterHeaderMs,
} from '../provider-http';
import {
  type ChannelProfile,
  type ErrorClass,
  isRemoteMediaRef,
  type MediaFile,
  type MetricsSnapshot,
  type Pkce,
  type ProviderContext,
  type PublishItem,
  type RemoteMediaRef,
  type RemoteRef,
  type SocialProvider,
  type TokenSet,
} from '../provider.types';
import {
  X_API_BASE,
  X_AUTHORIZE_URL,
  X_MAX_IDS_PER_LOOKUP,
  X_POST_FIELDS_PARAM,
  X_SCOPES,
  X_TOKEN_URL,
} from './x.constants';

export interface XProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** X error body: a Problem (`type`, `title`, `detail`), a legacy `errors[]`, or an OAuth error. */
interface XErrorBody {
  type?: string;
  title?: string;
  detail?: string;
  errors?: Array<{ message?: string; code?: number }>;
  error?: string;
  error_description?: string;
}

interface XTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

interface XPublicMetrics {
  impression_count?: number;
  like_count?: number;
  retweet_count?: number;
  reply_count?: number;
  quote_count?: number;
  bookmark_count?: number;
}

type Operation = 'token' | 'refresh' | 'profile' | 'media' | 'publish' | 'metrics';

export class XProvider implements SocialProvider {
  readonly id = 'x' as const;
  readonly limits = PROVIDER_LIMITS.x;
  readonly scopes = X_SCOPES;

  constructor(private readonly config: XProviderConfig) {}

  getAuthorizationUrl(state: string, pkce: Pkce): URL {
    const url = new URL(X_AUTHORIZE_URL);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.scopes.join(' '),
      state,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: pkce.codeChallengeMethod,
    });
    // X's examples encode the scope separator as %20; URLSearchParams would emit '+'.
    url.search = params.toString().replace(/\+/g, '%20');
    return url;
  }

  async exchangeCode(code: string, pkce: Pkce): Promise<TokenSet> {
    const res = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: pkce.codeVerifier,
    });
    if (!res.ok) throw await this.errorFromResponse(res, 'token');
    return this.parseTokens(await readJson<XTokenResponse>(res));
  }

  async refresh(tokens: TokenSet): Promise<TokenSet> {
    if (!tokens.refreshToken) {
      throw new ReauthRequired('x', {
        code: 'REFRESH_UNAVAILABLE',
        message: 'The X connection has no refresh token. Reconnect the channel.',
      });
    }
    const res = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    });
    if (!res.ok) throw await this.errorFromResponse(res, 'refresh');
    // X rotates refresh tokens: the previous one stops working once a new one is issued,
    // so callers must persist the returned set (and serialize refreshes per channel).
    return this.parseTokens(await readJson<XTokenResponse>(res), tokens.refreshToken);
  }

  async getProfile(tokens: TokenSet): Promise<ChannelProfile> {
    const url = new URL(`${X_API_BASE}/2/users/me`);
    url.searchParams.set('user.fields', 'name,username,profile_image_url');
    const res = await providerFetch('x', url, { headers: bearer(tokens.accessToken) });
    if (!res.ok) throw await this.errorFromResponse(res, 'profile');
    const body = await readJson<{
      data?: { id?: string; username?: string; name?: string; profile_image_url?: string };
    }>(res);
    const user = body?.data;
    if (!user?.id || !user.username) throw unexpected('profile');
    return {
      externalId: user.id,
      handle: user.username,
      displayName: user.name ?? null,
      // TODO: X serves a 48 px `_normal` avatar; consider a larger variant for the UI.
      avatarUrl: user.profile_image_url ?? null,
    };
  }

  /** Simple (one-shot) v2 upload, which X documents for images and small files. */
  async uploadMedia(ctx: ProviderContext, file: MediaFile): Promise<RemoteMediaRef> {
    this.assertMediaAllowed(file);
    const form = new FormData();
    form.append('media', new Blob([new Uint8Array(file.buffer)], { type: file.mime }), 'media');
    // Our pipeline only produces static images (static GIFs included), so tweet_image fits.
    form.append('media_category', 'tweet_image');
    const res = await providerFetch('x', `${X_API_BASE}/2/media/upload`, {
      method: 'POST',
      headers: bearer(ctx.tokens.accessToken),
      body: form,
    });
    if (!res.ok) throw await this.errorFromResponse(res, 'media');
    const body = await readJson<{
      data?: { id?: string; processing_info?: { state?: string } };
    }>(res);
    const id = body?.data?.id;
    if (!id) throw unexpected('media');
    if (body?.data?.processing_info?.state === 'failed') {
      throw new PermanentProviderError('x', {
        code: 'MEDIA_REJECTED',
        message: 'X could not process the image.',
      });
    }
    // TODO: poll GET /2/media/upload?command=STATUS when processing_info is pending.
    // Images are not processed asynchronously in practice; animated GIFs/videos are out of scope.
    return { id };
  }

  async publishItem(
    ctx: ProviderContext,
    item: PublishItem,
    replyTo?: RemoteRef,
  ): Promise<RemoteRef> {
    if (item.media.length > this.limits.maxImagesPerItem) {
      throw new PermanentProviderError('x', {
        code: 'TOO_MANY_IMAGES',
        message: `X accepts at most ${this.limits.maxImagesPerItem} images per post.`,
      });
    }
    const mediaIds: string[] = [];
    for (const media of item.media) {
      mediaIds.push(isRemoteMediaRef(media) ? media.id : (await this.uploadMedia(ctx, media)).id);
    }

    const payload: Record<string, unknown> = { text: item.text };
    if (mediaIds.length > 0) payload.media = { media_ids: mediaIds };
    // Self-replies (threads) are allowed; since 2026-02-23 self-serve apps may not reply
    // to other accounts unless summoned, which this app never does.
    if (replyTo) payload.reply = { in_reply_to_tweet_id: replyTo.id };

    const res = await providerFetch('x', `${X_API_BASE}/2/tweets`, {
      method: 'POST',
      headers: { ...bearer(ctx.tokens.accessToken), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await this.errorFromResponse(res, 'publish');
    const body = await readJson<{ data?: { id?: string } }>(res);
    const id = body?.data?.id;
    if (!id) throw unexpected('publish');
    return { id, url: tweetUrl(ctx.account.handle, id) };
  }

  /**
   * Public metrics for the given posts, in batches of 100 ids per request.
   * `public_metrics` already includes `impression_count`; the owner-only
   * `non_public_metrics` are skipped (30-day window, not needed for the MVP).
   * Posts X no longer returns (deleted, protected) are omitted from the result.
   */
  async fetchMetrics(ctx: ProviderContext, refs: RemoteRef[]): Promise<MetricsSnapshot[]> {
    const ids = [...new Set(refs.map((r) => r.id))];
    const out: MetricsSnapshot[] = [];
    for (const batch of chunk(ids, X_MAX_IDS_PER_LOOKUP)) {
      const url = new URL(`${X_API_BASE}/2/tweets`);
      url.searchParams.set('ids', batch.join(','));
      url.searchParams.set(X_POST_FIELDS_PARAM, 'public_metrics');
      const res = await providerFetch('x', url, { headers: bearer(ctx.tokens.accessToken) });
      if (!res.ok) throw await this.errorFromResponse(res, 'metrics');
      const body = await readJson<{
        data?: Array<{ id: string; public_metrics?: XPublicMetrics }>;
      }>(res);
      for (const post of body?.data ?? []) {
        const m = post.public_metrics ?? {};
        out.push({
          remoteId: post.id,
          impressions: m.impression_count,
          likes: m.like_count,
          reposts: m.retweet_count,
          replies: m.reply_count,
          quotes: m.quote_count,
          bookmarks: m.bookmark_count,
          raw: post,
        });
      }
    }
    return out;
  }

  classifyError(err: unknown): ErrorClass {
    return classifyProviderError(err);
  }

  /** Maps an X error response to a typed provider error. Exposed for tests and reuse. */
  async errorFromResponse(res: Response, op: Operation): Promise<ProviderError> {
    const body = (await readJson<XErrorBody>(res)) ?? {};
    const detail = truncateDetail(
      body.detail ?? body.errors?.[0]?.message ?? body.error_description ?? body.title,
    );
    const status = res.status;
    const suffix = detail ? `: ${detail}` : '.';

    // OAuth token endpoint: a rejected refresh token (X answers 400 invalid_request,
    // other servers invalid_grant) means the user must reconnect.
    if (op === 'refresh' && (status === 400 || status === 401)) {
      return new ReauthRequired('x', {
        code: 'REFRESH_REJECTED',
        status,
        message: 'X rejected the refresh token. Reconnect the X channel.',
      });
    }
    if (op === 'token' && status >= 400 && status < 500 && status !== 429) {
      return new PermanentProviderError('x', {
        code: 'OAUTH_EXCHANGE_FAILED',
        status,
        message: `X did not accept the authorization code${suffix}`,
      });
    }

    if (status === 429) {
      if (body.type?.endsWith('/usage-capped')) {
        return new PermanentProviderError('x', {
          code: 'X_USAGE_CAPPED',
          status,
          message:
            'The X API usage cap or credit balance is exhausted. Top up credits in the X Developer Console.',
        });
      }
      return new RetryableProviderError('x', {
        code: 'RATE_LIMITED',
        status,
        message: 'X rate limit reached; retrying later.',
        retryAfterMs: rateLimitResetMs(res),
      });
    }
    if (status === 402) {
      // TODO: not documented; defensive mapping for "credits depleted" on pay-per-use.
      return new PermanentProviderError('x', {
        code: 'X_CREDITS_DEPLETED',
        status,
        message:
          'The X API credit balance is exhausted. Top up credits in the X Developer Console.',
      });
    }
    if (status >= 500) {
      return new RetryableProviderError('x', {
        code: 'UPSTREAM_ERROR',
        status,
        message: `X is having problems (HTTP ${status}); retrying later.`,
        retryAfterMs: retryAfterHeaderMs(res),
      });
    }
    if (status === 401) {
      return new ReauthRequired('x', {
        code: 'TOKEN_REJECTED',
        status,
        message: 'X rejected the access token. Reconnect the X channel.',
      });
    }
    if (status === 403) {
      if (/duplicate/i.test(detail ?? '')) {
        return new PermanentProviderError('x', {
          code: 'DUPLICATE_CONTENT',
          status,
          message: 'X rejected the post as duplicate content. Change the text and try again.',
        });
      }
      if (body.type?.endsWith('/client-forbidden')) {
        return new PermanentProviderError('x', {
          code: 'X_CLIENT_FORBIDDEN',
          status,
          message: `The X developer app lacks access to this endpoint${suffix}`,
        });
      }
      return new PermanentProviderError('x', {
        code: 'FORBIDDEN',
        status,
        message: `X refused the request${suffix}`,
      });
    }
    if (status === 400) {
      return new PermanentProviderError('x', {
        code: 'INVALID_REQUEST',
        status,
        message: `X rejected the request as invalid${suffix}`,
      });
    }
    return new PermanentProviderError('x', {
      code: status === 404 ? 'NOT_FOUND' : 'REQUEST_REJECTED',
      status,
      message: `X rejected the request (HTTP ${status})${suffix}`,
    });
  }

  private tokenRequest(form: Record<string, string>): Promise<Response> {
    return providerFetch('x', X_TOKEN_URL, {
      method: 'POST',
      headers: {
        authorization: basicAuth(this.config.clientId, this.config.clientSecret),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
    });
  }

  private parseTokens(body: XTokenResponse | undefined, previousRefreshToken?: string): TokenSet {
    if (!body?.access_token) throw unexpected('token');
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? previousRefreshToken,
      expiresAt: expiryFromSeconds(body.expires_in),
      scopes: parseScopes(body.scope),
    };
  }

  private assertMediaAllowed(file: MediaFile): void {
    if (!this.limits.allowedMimeTypes.includes(file.mime)) {
      throw new PermanentProviderError('x', {
        code: 'MEDIA_REJECTED',
        message: `X does not accept ${file.mime} images.`,
      });
    }
    if (file.buffer.length > this.limits.maxImageBytes) {
      throw new PermanentProviderError('x', {
        code: 'MEDIA_REJECTED',
        message: `Image too large for X (max ${Math.round(this.limits.maxImageBytes / 1024 / 1024)} MB).`,
      });
    }
  }
}

export function tweetUrl(handle: string, id: string): string {
  return `https://x.com/${encodeURIComponent(handle)}/status/${id}`;
}

function bearer(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}` };
}

/** `x-rate-limit-reset` is a Unix timestamp in seconds; falls back to `Retry-After`. */
function rateLimitResetMs(res: Response, now = Date.now()): number | undefined {
  const reset = Number(res.headers.get('x-rate-limit-reset'));
  if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - now);
  return retryAfterHeaderMs(res, now);
}

function unexpected(op: Operation): PermanentProviderError {
  return new PermanentProviderError('x', {
    code: 'UNEXPECTED_RESPONSE',
    message: `X returned an unexpected response (${op}).`,
  });
}
