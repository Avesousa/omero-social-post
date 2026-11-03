/**
 * LinkedIn adapter: Sign In with LinkedIn using OpenID Connect + Share on LinkedIn
 * (self-serve products), posting to the member's personal profile.
 *
 * Verified on 2026-10-28/29 against:
 * - https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
 *   (authorize/token URLs, client_secret in the form body, 60-day access tokens, error codes)
 * - https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens
 *   (refresh tokens only for approved MDP partners; 365-day TTL not extended; 400 on invalid refresh)
 * - https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
 *   (scopes openid/profile, GET /v2/userinfo: sub, name, picture)
 * - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-10
 *   (POST /rest/posts, headers, body, 201 + x-restli-id, post URL, error table)
 * - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-10
 *   (initializeUpload, JPG/GIF/PNG, < 36,152,320 pixels, w_member_social is write-only)
 * - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api?view=li-lms-2026-10
 *   (content.multiImage.images: 2–20 images)
 * - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/vector-asset-api
 *   (PUT bytes to uploadUrl with the Bearer token; 201)
 * - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
 *   (commentary escaping, hashtag template)
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
  type Pkce,
  type ProviderContext,
  type PublishItem,
  type RemoteMediaRef,
  type RemoteRef,
  type SocialProvider,
  type TokenSet,
} from '../provider.types';
import {
  LINKEDIN_API_BASE,
  LINKEDIN_API_VERSION,
  LINKEDIN_AUTHORIZE_URL,
  LINKEDIN_MULTI_IMAGE_MIN,
  LINKEDIN_RESTLI_PROTOCOL_VERSION,
  LINKEDIN_SCOPES,
  LINKEDIN_TOKEN_URL,
} from './linkedin.constants';
import { toLinkedInCommentary } from './little-text';

export interface LinkedInProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** OAuth errors (`error`, `error_description`) or REST errors (`message`, `code`, `serviceErrorCode`). */
interface LinkedInErrorBody {
  error?: string;
  error_description?: string;
  message?: string;
  code?: string;
  serviceErrorCode?: number;
}

interface LinkedInTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

type Operation = 'token' | 'refresh' | 'profile' | 'media' | 'publish';

export class LinkedInProvider implements SocialProvider {
  readonly id = 'linkedin' as const;
  readonly limits = PROVIDER_LIMITS.linkedin;
  readonly scopes = LINKEDIN_SCOPES;

  constructor(private readonly config: LinkedInProviderConfig) {}

  /**
   * LinkedIn's web (confidential client) flow authenticates with the client secret and
   * `state`; PKCE is only documented for native apps enabled by LinkedIn, so `pkce` is
   * deliberately not sent.
   */
  getAuthorizationUrl(state: string, _pkce: Pkce): URL {
    const url = new URL(LINKEDIN_AUTHORIZE_URL);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      state,
      scope: this.scopes.join(' '),
    });
    url.search = params.toString().replace(/\+/g, '%20');
    return url;
  }

  async exchangeCode(code: string, _pkce: Pkce): Promise<TokenSet> {
    const res = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
    });
    if (!res.ok) throw await this.errorFromResponse(res, 'token');
    return this.parseTokens(await readJson<LinkedInTokenResponse>(res));
  }

  /**
   * Self-serve apps do not get refresh tokens (only approved Marketing Developer
   * Platform partners do), so an expiring LinkedIn token normally means reconnecting.
   */
  async refresh(tokens: TokenSet): Promise<TokenSet> {
    if (!tokens.refreshToken) {
      throw new ReauthRequired('linkedin', {
        code: 'REFRESH_UNAVAILABLE',
        message:
          'The LinkedIn access token expires and cannot be renewed automatically. Reconnect the LinkedIn channel.',
      });
    }
    const res = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    });
    if (!res.ok) throw await this.errorFromResponse(res, 'refresh');
    const next = this.parseTokens(await readJson<LinkedInTokenResponse>(res));
    return {
      ...next,
      refreshToken: next.refreshToken ?? tokens.refreshToken,
      // Refreshing does not extend the refresh token's lifetime.
      refreshExpiresAt: next.refreshExpiresAt ?? tokens.refreshExpiresAt,
    };
  }

  async getProfile(tokens: TokenSet): Promise<ChannelProfile> {
    const res = await providerFetch('linkedin', `${LINKEDIN_API_BASE}/v2/userinfo`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!res.ok) throw await this.errorFromResponse(res, 'profile');
    const body = await readJson<{ sub?: string; name?: string; picture?: string }>(res);
    if (!body?.sub) throw unexpected('profile');
    const name = body.name?.trim() || null;
    return {
      externalId: body.sub,
      // OIDC exposes no vanity name; the full name doubles as the handle.
      handle: name ?? body.sub,
      displayName: name,
      avatarUrl: body.picture ?? null,
    };
  }

  /** Images API: initializeUpload for the member, then PUT the bytes to the returned URL. */
  async uploadMedia(ctx: ProviderContext, file: MediaFile): Promise<RemoteMediaRef> {
    this.assertMediaAllowed(file);
    const init = await providerFetch(
      'linkedin',
      `${LINKEDIN_API_BASE}/rest/images?action=initializeUpload`,
      {
        method: 'POST',
        headers: { ...this.restHeaders(ctx.tokens), 'content-type': 'application/json' },
        body: JSON.stringify({
          initializeUploadRequest: { owner: personUrn(ctx.account.externalId) },
        }),
      },
    );
    if (!init.ok) throw await this.errorFromResponse(init, 'media');
    const body = await readJson<{ value?: { uploadUrl?: string; image?: string } }>(init);
    const uploadUrl = body?.value?.uploadUrl;
    const image = body?.value?.image;
    if (!uploadUrl || !image) throw unexpected('media');

    const put = await providerFetch('linkedin', uploadUrl, {
      method: 'PUT',
      headers: { authorization: `Bearer ${ctx.tokens.accessToken}`, 'content-type': file.mime },
      body: new Uint8Array(file.buffer),
      timeoutMs: 60_000,
    });
    if (!put.ok) throw await this.errorFromResponse(put, 'media');
    // TODO: images are processed asynchronously; a post referencing a still-processing
    // image may fail with 4xx. If that shows up, poll GET /rest/images/{urn} (needs more than w_member_social).
    return { id: image };
  }

  async publishItem(
    ctx: ProviderContext,
    item: PublishItem,
    replyTo?: RemoteRef,
  ): Promise<RemoteRef> {
    if (replyTo) {
      throw new PermanentProviderError('linkedin', {
        code: 'THREADS_UNSUPPORTED',
        message: 'LinkedIn posts cannot be threads.',
      });
    }
    if (item.media.length > this.limits.maxImagesPerItem) {
      throw new PermanentProviderError('linkedin', {
        code: 'TOO_MANY_IMAGES',
        message: `LinkedIn accepts at most ${this.limits.maxImagesPerItem} images per post.`,
      });
    }
    const imageUrns: string[] = [];
    for (const media of item.media) {
      imageUrns.push(isRemoteMediaRef(media) ? media.id : (await this.uploadMedia(ctx, media)).id);
    }

    const payload: Record<string, unknown> = {
      author: personUrn(ctx.account.externalId),
      commentary: toLinkedInCommentary(item.text),
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    if (imageUrns.length === 1) {
      payload.content = { media: { id: imageUrns[0] } };
    } else if (imageUrns.length >= LINKEDIN_MULTI_IMAGE_MIN) {
      payload.content = { multiImage: { images: imageUrns.map((id) => ({ id })) } };
    }

    const res = await providerFetch('linkedin', `${LINKEDIN_API_BASE}/rest/posts`, {
      method: 'POST',
      headers: { ...this.restHeaders(ctx.tokens), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await this.errorFromResponse(res, 'publish');
    const urn = res.headers.get('x-restli-id');
    if (!urn) throw unexpected('publish');
    return { id: urn, url: linkedInPostUrl(urn) };
  }

  // fetchMetrics is intentionally not implemented: member post analytics need the
  // restricted r_member_social / analytics permissions, out of scope for self-serve apps.

  classifyError(err: unknown): ErrorClass {
    return classifyProviderError(err);
  }

  async errorFromResponse(res: Response, op: Operation): Promise<ProviderError> {
    const body = (await readJson<LinkedInErrorBody>(res)) ?? {};
    const detail = truncateDetail(body.message ?? body.error_description ?? body.error);
    const status = res.status;
    const suffix = detail ? `: ${detail}` : '.';

    // Expired/revoked refresh tokens come back as 400 invalid_request.
    if (op === 'refresh' && (status === 400 || status === 401)) {
      return new ReauthRequired('linkedin', {
        code: 'REFRESH_REJECTED',
        status,
        message: 'LinkedIn rejected the refresh token. Reconnect the LinkedIn channel.',
      });
    }
    if (op === 'token' && status >= 400 && status < 500 && status !== 429) {
      return new PermanentProviderError('linkedin', {
        code: 'OAUTH_EXCHANGE_FAILED',
        status,
        message: `LinkedIn did not accept the authorization code${suffix}`,
      });
    }
    if (status === 429 || status === 409 || status >= 500) {
      // 409 is a write conflict that LinkedIn documents as retryable.
      return new RetryableProviderError('linkedin', {
        code: status === 429 ? 'RATE_LIMITED' : status === 409 ? 'CONFLICT' : 'UPSTREAM_ERROR',
        status,
        message:
          status === 429
            ? 'LinkedIn rate limit reached; retrying later.'
            : `LinkedIn is having problems (HTTP ${status}); retrying later.`,
        retryAfterMs: retryAfterHeaderMs(res),
      });
    }
    if (status === 401) {
      return new ReauthRequired('linkedin', {
        code: 'TOKEN_REJECTED',
        status,
        message:
          'LinkedIn rejected the access token (expired or revoked). Reconnect the LinkedIn channel.',
      });
    }
    if (/duplicate/i.test(detail ?? '')) {
      return new PermanentProviderError('linkedin', {
        code: 'DUPLICATE_CONTENT',
        status,
        message: 'LinkedIn rejected the post as a duplicate. Change the text and try again.',
      });
    }
    if (status === 403) {
      return new PermanentProviderError('linkedin', {
        code: 'ACCESS_DENIED',
        status,
        message: `LinkedIn denied the request (check the w_member_social permission)${suffix}`,
      });
    }
    if (status === 400 || status === 422) {
      return new PermanentProviderError('linkedin', {
        code: 'INVALID_REQUEST',
        status,
        message: `LinkedIn rejected the post${suffix}`,
      });
    }
    return new PermanentProviderError('linkedin', {
      code: status === 404 ? 'NOT_FOUND' : 'REQUEST_REJECTED',
      status,
      message: `LinkedIn rejected the request (HTTP ${status})${suffix}`,
    });
  }

  private restHeaders(tokens: TokenSet): Record<string, string> {
    return {
      authorization: `Bearer ${tokens.accessToken}`,
      'linkedin-version': LINKEDIN_API_VERSION,
      'x-restli-protocol-version': LINKEDIN_RESTLI_PROTOCOL_VERSION,
    };
  }

  private tokenRequest(form: Record<string, string>): Promise<Response> {
    // LinkedIn expects the client credentials in the form body.
    return providerFetch('linkedin', LINKEDIN_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...form,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }).toString(),
    });
  }

  private parseTokens(body: LinkedInTokenResponse | undefined): TokenSet {
    if (!body?.access_token) throw unexpected('token');
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: expiryFromSeconds(body.expires_in),
      refreshExpiresAt: expiryFromSeconds(body.refresh_token_expires_in),
      scopes: parseScopes(body.scope),
    };
  }

  private assertMediaAllowed(file: MediaFile): void {
    if (!this.limits.allowedMimeTypes.includes(file.mime)) {
      throw new PermanentProviderError('linkedin', {
        code: 'MEDIA_REJECTED',
        message: `LinkedIn does not accept ${file.mime} images.`,
      });
    }
    if (file.buffer.length > this.limits.maxImageBytes) {
      throw new PermanentProviderError('linkedin', {
        code: 'MEDIA_REJECTED',
        message: `Image too large for LinkedIn (max ${Math.round(this.limits.maxImageBytes / 1024 / 1024)} MB).`,
      });
    }
  }
}

export function personUrn(personId: string): string {
  return `urn:li:person:${personId}`;
}

export function linkedInPostUrl(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}/`;
}

function unexpected(op: Operation): PermanentProviderError {
  return new PermanentProviderError('linkedin', {
    code: 'UNEXPECTED_RESPONSE',
    message: `LinkedIn returned an unexpected response (${op}).`,
  });
}
