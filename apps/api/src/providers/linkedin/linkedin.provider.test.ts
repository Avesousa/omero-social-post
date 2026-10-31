import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { LINKEDIN_FIXTURES } from '../../../test/msw/handlers/linkedin';
import { server } from '../../../test/msw/server';
import { pkceFromVerifier } from '../oauth-state.store';
import { PermanentProviderError, ReauthRequired, RetryableProviderError } from '../provider-errors';
import { type ProviderContext, type SocialProvider } from '../provider.types';
import { LINKEDIN_API_BASE, LINKEDIN_API_VERSION, LINKEDIN_WWW_BASE } from './linkedin.constants';
import { LinkedInProvider } from './linkedin.provider';
import { escapeLittleText, toLinkedInCommentary } from './little-text';

const REDIRECT = 'http://localhost:3000/api/v1/channels/linkedin/callback';
const provider = new LinkedInProvider({
  clientId: 'li-client',
  clientSecret: 'li-secret',
  redirectUri: REDIRECT,
});
const pkce = pkceFromVerifier('v'.repeat(43));
const ctx: ProviderContext = {
  tokens: { accessToken: 'li-access', scopes: ['openid', 'profile', 'w_member_social'] },
  account: { externalId: LINKEDIN_FIXTURES.userinfo.sub, handle: 'Omero Dev' },
};
const jpeg = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), mime: 'image/jpeg' };

async function thrown(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (err: unknown) => err,
  );
}

/** Captures POST /rest/posts requests while answering like LinkedIn. */
function capturePosts() {
  const requests: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  server.use(
    http.post(`${LINKEDIN_API_BASE}/rest/posts`, async ({ request }) => {
      requests.push({
        headers: request.headers,
        body: (await request.json()) as Record<string, unknown>,
      });
      return new HttpResponse(null, {
        status: 201,
        headers: { 'x-restli-id': 'urn:li:share:7390000000000000123' },
      });
    }),
  );
  return requests;
}

describe('LinkedInProvider', () => {
  describe('OAuth', () => {
    it('builds the consent URL with state and scopes', () => {
      const url = provider.getAuthorizationUrl('state-abc', pkce);
      expect(url.origin + url.pathname).toBe('https://www.linkedin.com/oauth/v2/authorization');
      const q = url.searchParams;
      expect(q.get('response_type')).toBe('code');
      expect(q.get('client_id')).toBe('li-client');
      expect(q.get('redirect_uri')).toBe(REDIRECT);
      expect(q.get('state')).toBe('state-abc');
      expect(q.get('scope')).toBe('openid profile w_member_social');
      // PKCE is not part of LinkedIn's web (confidential client) flow.
      expect(q.has('code_challenge')).toBe(false);
    });

    it('exchanges the code with client credentials in the body', async () => {
      let form: URLSearchParams | undefined;
      server.use(
        http.post(`${LINKEDIN_WWW_BASE}/oauth/v2/accessToken`, async ({ request }) => {
          form = new URLSearchParams(await request.text());
          return HttpResponse.json(LINKEDIN_FIXTURES.token);
        }),
      );
      const before = Date.now();
      const tokens = await provider.exchangeCode('li-code', pkce);

      expect(Object.fromEntries(form!)).toEqual({
        grant_type: 'authorization_code',
        code: 'li-code',
        redirect_uri: REDIRECT,
        client_id: 'li-client',
        client_secret: 'li-secret',
      });
      expect(tokens.accessToken).toBe(LINKEDIN_FIXTURES.token.access_token);
      expect(tokens.refreshToken).toBeUndefined();
      expect(tokens.scopes).toEqual(['openid', 'profile', 'w_member_social']);
      const days = (tokens.expiresAt!.getTime() - before) / 86_400_000;
      expect(days).toBeGreaterThan(59.9);
      expect(days).toBeLessThan(60.1);
    });

    it('reports a rejected code as permanent', async () => {
      const err = await thrown(provider.exchangeCode(LINKEDIN_FIXTURES.badCode, pkce));
      expect(err).toBeInstanceOf(PermanentProviderError);
      expect(err).toMatchObject({ code: 'OAUTH_EXCHANGE_FAILED', status: 401 });
    });

    it('requires reconnecting when no refresh token was issued (self-serve apps)', async () => {
      const err = await thrown(provider.refresh(ctx.tokens));
      expect(err).toBeInstanceOf(ReauthRequired);
      expect(err).toMatchObject({ code: 'REFRESH_UNAVAILABLE' });
      expect(provider.classifyError(err)).toBe('auth');
    });

    it('refreshes when a refresh token exists and keeps its expiry', async () => {
      const refreshExpiresAt = new Date('2027-06-01T00:00:00Z');
      const next = await provider.refresh({
        ...ctx.tokens,
        refreshToken: 'li-refresh',
        refreshExpiresAt,
      });
      expect(next.accessToken).toMatch(/^li-access-token-\d+$/);
      expect(next.refreshToken).toBe('li-refresh');
      expect(next.refreshExpiresAt).toBeInstanceOf(Date);
    });

    it('maps a revoked refresh token to ReauthRequired', async () => {
      const err = await thrown(
        provider.refresh({ ...ctx.tokens, refreshToken: LINKEDIN_FIXTURES.revokedRefreshToken }),
      );
      expect(err).toBeInstanceOf(ReauthRequired);
      expect(err).toMatchObject({ code: 'REFRESH_REJECTED' });
    });
  });

  it('maps the profile from /v2/userinfo', async () => {
    expect(await provider.getProfile(ctx.tokens)).toEqual({
      externalId: 'Ab1Cd2Ef3G',
      handle: 'Omero Dev',
      displayName: 'Omero Dev',
      avatarUrl: LINKEDIN_FIXTURES.userinfo.picture,
    });
  });

  describe('media', () => {
    it('initializes the upload for the member and PUTs the bytes', async () => {
      let init: { headers: Headers; body: unknown } | undefined;
      let put: { auth: string | null; type: string | null; size: number } | undefined;
      server.use(
        http.post(`${LINKEDIN_API_BASE}/rest/images`, async ({ request }) => {
          init = { headers: request.headers, body: await request.json() };
          return HttpResponse.json({
            value: {
              uploadUrlExpiresAt: Date.now() + 1000,
              uploadUrl: `${LINKEDIN_WWW_BASE}/dms-uploads/IMG1/uploaded-image/0?sync=1`,
              image: 'urn:li:image:IMG1',
            },
          });
        }),
        http.put(`${LINKEDIN_WWW_BASE}/dms-uploads/IMG1/uploaded-image/0`, async ({ request }) => {
          put = {
            auth: request.headers.get('authorization'),
            type: request.headers.get('content-type'),
            size: (await request.arrayBuffer()).byteLength,
          };
          return new HttpResponse(null, { status: 201 });
        }),
      );
      const ref = await provider.uploadMedia(ctx, jpeg);

      expect(ref).toEqual({ id: 'urn:li:image:IMG1' });
      expect(init?.body).toEqual({
        initializeUploadRequest: { owner: 'urn:li:person:Ab1Cd2Ef3G' },
      });
      expect(init?.headers.get('linkedin-version')).toBe(LINKEDIN_API_VERSION);
      expect(init?.headers.get('x-restli-protocol-version')).toBe('2.0.0');
      expect(put).toEqual({ auth: 'Bearer li-access', type: 'image/jpeg', size: 4 });
    });

    it('rejects WebP, which the Images API does not accept', async () => {
      await expect(
        provider.uploadMedia(ctx, { buffer: Buffer.alloc(1), mime: 'image/webp' }),
      ).rejects.toMatchObject({ code: 'MEDIA_REJECTED' });
    });
  });

  describe('publishItem', () => {
    it('publishes a text post with the versioned headers and returns its URN and URL', async () => {
      const requests = capturePosts();
      const ref = await provider.publishItem(ctx, {
        text: 'Hola (LinkedIn) #buildinpublic',
        media: [],
      });

      expect(ref).toEqual({
        id: 'urn:li:share:7390000000000000123',
        url: 'https://www.linkedin.com/feed/update/urn:li:share:7390000000000000123/',
      });
      const [req] = requests;
      expect(req!.headers.get('linkedin-version')).toMatch(/^\d{6}$/);
      expect(req!.headers.get('x-restli-protocol-version')).toBe('2.0.0');
      expect(req!.headers.get('authorization')).toBe('Bearer li-access');
      expect(req!.body).toEqual({
        author: 'urn:li:person:Ab1Cd2Ef3G',
        commentary: 'Hola \\(LinkedIn\\) {hashtag|\\#|buildinpublic}',
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      });
    });

    it('publishes a single-image post (upload + content.media)', async () => {
      const requests = capturePosts();
      await provider.publishItem(ctx, { text: 'Con imagen', media: [jpeg] });
      const content = requests[0]!.body.content as { media: { id: string } };
      expect(content.media.id).toMatch(/^urn:li:image:/);
    });

    it('publishes a multi-image post (content.multiImage)', async () => {
      const requests = capturePosts();
      await provider.publishItem(ctx, {
        text: 'Dos imágenes',
        media: [jpeg, { id: 'urn:li:image:EXISTING' }],
      });
      const content = requests[0]!.body.content as {
        multiImage: { images: Array<{ id: string }> };
      };
      expect(content.multiImage.images).toHaveLength(2);
      expect(content.multiImage.images[0]!.id).toMatch(/^urn:li:image:/);
      expect(content.multiImage.images[1]).toEqual({ id: 'urn:li:image:EXISTING' });
    });

    it('refuses replies (LinkedIn has no threads)', async () => {
      const err = await thrown(
        provider.publishItem(ctx, { text: 'x', media: [] }, { id: 'urn:li:share:1', url: '' }),
      );
      expect(err).toMatchObject({ code: 'THREADS_UNSUPPORTED' });
    });

    it('does not implement metrics', () => {
      expect((provider as SocialProvider).fetchMetrics).toBeUndefined();
    });
  });

  describe('error classification', () => {
    const publishWith = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      server.use(
        http.post(`${LINKEDIN_API_BASE}/rest/posts`, () =>
          HttpResponse.json(body as object, { status, headers }),
        ),
      );
      return thrown(provider.publishItem(ctx, { text: 'x', media: [] }));
    };

    it('429 is retryable and honours Retry-After', async () => {
      const err = await publishWith(
        429,
        {
          status: 429,
          code: 'TOO_MANY_REQUESTS',
          message: 'Resource level throttle limit exceeded',
        },
        { 'retry-after': '30' },
      );
      expect(err).toBeInstanceOf(RetryableProviderError);
      expect(err).toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 30_000 });
    });

    it.each([500, 503])('%i is retryable', async (status) => {
      const err = await publishWith(status, { status, message: 'Internal Server Error' });
      expect(provider.classifyError(err)).toBe('retryable');
    });

    it('network errors are retryable', async () => {
      server.use(http.post(`${LINKEDIN_API_BASE}/rest/posts`, () => HttpResponse.error()));
      const err = await thrown(provider.publishItem(ctx, { text: 'x', media: [] }));
      expect(provider.classifyError(err)).toBe('retryable');
    });

    it('401 requires reauth', async () => {
      const err = await publishWith(401, {
        status: 401,
        serviceErrorCode: 65601,
        code: 'REVOKED_ACCESS_TOKEN',
        message: 'The token used in the request has been revoked by the user',
      });
      expect(err).toBeInstanceOf(ReauthRequired);
      expect(provider.classifyError(err)).toBe('auth');
    });

    it.each([
      [
        400,
        'FIELD_LENGTH_TOO_LONG',
        '/commentary length exceeds the allowed maximum',
        'INVALID_REQUEST',
      ],
      [422, 'UNPROCESSABLE_ENTITY', 'Unprocessable entity', 'INVALID_REQUEST'],
      [
        403,
        'ACCESS_DENIED',
        'Not enough permissions to access: partnerApiPostsExternal.CREATE',
        'ACCESS_DENIED',
      ],
      [
        422,
        'UNPROCESSABLE_ENTITY',
        'Content is a duplicate of urn:li:share:123',
        'DUPLICATE_CONTENT',
      ],
    ])('%i %s is permanent', async (status, code, message, expected) => {
      const err = await publishWith(status, { status, code, message });
      expect(provider.classifyError(err)).toBe('permanent');
      expect(err).toMatchObject({ code: expected, status });
    });
  });
});

describe('little text format', () => {
  it('escapes every reserved character', () => {
    expect(escapeLittleText('a|b{c}d@e[f]g(h)i<j>k#l\\m*n_o~p')).toBe(
      'a\\|b\\{c\\}d\\@e\\[f\\]g\\(h\\)i\\<j\\>k\\#l\\\\m\\*n\\_o\\~p',
    );
  });

  it('turns hashtags into hashtag templates and leaves other text escaped', () => {
    expect(toLinkedInCommentary('#café y #2026, pero no a#b ni # solo')).toBe(
      '{hashtag|\\#|café} y {hashtag|\\#|2026}, pero no a\\#b ni \\# solo',
    );
  });
});
