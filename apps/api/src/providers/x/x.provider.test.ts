import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { X_FIXTURES } from '../../../test/msw/handlers/x';
import { server } from '../../../test/msw/server';
import { pkceFromVerifier } from '../oauth-state.store';
import { PermanentProviderError, ReauthRequired, RetryableProviderError } from '../provider-errors';
import { type ProviderContext, type RemoteRef } from '../provider.types';
import { X_API_BASE } from './x.constants';
import { XProvider } from './x.provider';

const REDIRECT = 'http://localhost:3000/api/v1/channels/x/callback';
const provider = new XProvider({
  clientId: 'x-client',
  clientSecret: 'x-secret',
  redirectUri: REDIRECT,
});
const pkce = pkceFromVerifier('v'.repeat(43));
const ctx: ProviderContext = {
  tokens: { accessToken: 'x-access', refreshToken: 'x-refresh', scopes: [] },
  account: { externalId: X_FIXTURES.user.id, handle: X_FIXTURES.user.username },
};
const png = { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mime: 'image/png' };

/** Captures request bodies hitting POST /2/tweets while still answering like X. */
function captureTweets() {
  const bodies: Array<Record<string, unknown>> = [];
  let n = 100;
  server.use(
    http.post(`${X_API_BASE}/2/tweets`, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      n += 1;
      return HttpResponse.json({ data: { id: String(n), text: 't' } }, { status: 201 });
    }),
  );
  return bodies;
}

async function thrown(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (err: unknown) => err,
  );
}

describe('XProvider', () => {
  describe('OAuth', () => {
    it('builds the consent URL with state, S256 challenge and scopes', () => {
      const url = provider.getAuthorizationUrl('state-123', pkce);
      expect(url.origin + url.pathname).toBe('https://x.com/i/oauth2/authorize');
      const q = url.searchParams;
      expect(q.get('response_type')).toBe('code');
      expect(q.get('client_id')).toBe('x-client');
      expect(q.get('redirect_uri')).toBe(REDIRECT);
      expect(q.get('state')).toBe('state-123');
      expect(q.get('code_challenge')).toBe(pkce.codeChallenge);
      expect(q.get('code_challenge_method')).toBe('S256');
      expect(q.get('scope')).toBe('tweet.read tweet.write users.read media.write offline.access');
      expect(url.search).toContain('scope=tweet.read%20tweet.write');
    });

    it('exchanges the code with Basic auth and the PKCE verifier', async () => {
      let seen: { auth: string | null; form: URLSearchParams } | undefined;
      server.use(
        http.post(`${X_API_BASE}/2/oauth2/token`, async ({ request }) => {
          seen = {
            auth: request.headers.get('authorization'),
            form: new URLSearchParams(await request.text()),
          };
          return HttpResponse.json(X_FIXTURES.token);
        }),
      );
      const before = Date.now();
      const tokens = await provider.exchangeCode('the-code', pkce);

      expect(seen?.auth).toBe(`Basic ${Buffer.from('x-client:x-secret').toString('base64')}`);
      expect(Object.fromEntries(seen!.form)).toEqual({
        grant_type: 'authorization_code',
        code: 'the-code',
        redirect_uri: REDIRECT,
        code_verifier: pkce.codeVerifier,
      });
      expect(tokens).toMatchObject({
        accessToken: X_FIXTURES.token.access_token,
        refreshToken: X_FIXTURES.token.refresh_token,
        scopes: ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'],
      });
      const ttl = tokens.expiresAt!.getTime() - before;
      expect(ttl).toBeGreaterThanOrEqual(7_199_000);
      expect(ttl).toBeLessThanOrEqual(7_201_000);
    });

    it('reports a rejected authorization code as a permanent error', async () => {
      const err = await thrown(provider.exchangeCode(X_FIXTURES.badCode, pkce));
      expect(err).toBeInstanceOf(PermanentProviderError);
      expect(err).toMatchObject({ code: 'OAUTH_EXCHANGE_FAILED', status: 400 });
    });

    it('refreshes with rotation: the new refresh token replaces the old one', async () => {
      const next = await provider.refresh(ctx.tokens);
      expect(next.accessToken).toMatch(/^x-access-token-\d+$/);
      expect(next.refreshToken).toMatch(/^x-refresh-token-\d+$/);
      expect(next.refreshToken).not.toBe(ctx.tokens.refreshToken);
      expect(next.expiresAt).toBeInstanceOf(Date);
    });

    it('keeps the old refresh token if X does not return a new one', async () => {
      server.use(
        http.post(`${X_API_BASE}/2/oauth2/token`, () =>
          HttpResponse.json({ access_token: 'only-access', expires_in: 7200, scope: 'tweet.read' }),
        ),
      );
      const next = await provider.refresh(ctx.tokens);
      expect(next.refreshToken).toBe('x-refresh');
    });

    it('maps a revoked refresh token (invalid_request) to ReauthRequired', async () => {
      const err = await thrown(
        provider.refresh({ ...ctx.tokens, refreshToken: X_FIXTURES.revokedRefreshToken }),
      );
      expect(err).toBeInstanceOf(ReauthRequired);
      expect(provider.classifyError(err)).toBe('auth');
    });

    it('maps invalid_grant on refresh to ReauthRequired', async () => {
      server.use(
        http.post(`${X_API_BASE}/2/oauth2/token`, () =>
          HttpResponse.json({ error: 'invalid_grant' }, { status: 400 }),
        ),
      );
      expect(await thrown(provider.refresh(ctx.tokens))).toBeInstanceOf(ReauthRequired);
    });

    it('requires reconnecting when there is no refresh token', async () => {
      const err = await thrown(provider.refresh({ accessToken: 'a', scopes: [] }));
      expect(err).toMatchObject({ code: 'REFRESH_UNAVAILABLE' });
      expect(err).toBeInstanceOf(ReauthRequired);
    });
  });

  it('maps the profile from GET /2/users/me', async () => {
    let query: URLSearchParams | undefined;
    server.use(
      http.get(`${X_API_BASE}/2/users/me`, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json({ data: X_FIXTURES.user });
      }),
    );
    expect(await provider.getProfile(ctx.tokens)).toEqual({
      externalId: X_FIXTURES.user.id,
      handle: 'omero_dev',
      displayName: 'Omero Dev',
      avatarUrl: X_FIXTURES.user.profile_image_url,
    });
    expect(query?.get('user.fields')).toContain('profile_image_url');
  });

  describe('media', () => {
    it('uploads an image through the v2 endpoint as tweet_image', async () => {
      let form: FormData | undefined;
      server.use(
        http.post(`${X_API_BASE}/2/media/upload`, async ({ request }) => {
          form = await request.formData();
          return HttpResponse.json({ data: { id: '1880000000000009999', media_key: '3_1' } });
        }),
      );
      const ref = await provider.uploadMedia(ctx, png);
      expect(ref).toEqual({ id: '1880000000000009999' });
      expect(form?.get('media_category')).toBe('tweet_image');
      const media = form?.get('media') as Blob;
      expect(media.type).toBe('image/png');
      expect(media.size).toBe(4);
    });

    it('rejects unsupported or oversized images before calling X', async () => {
      await expect(
        provider.uploadMedia(ctx, { buffer: Buffer.alloc(1), mime: 'image/bmp' }),
      ).rejects.toMatchObject({
        code: 'MEDIA_REJECTED',
      });
      await expect(
        provider.uploadMedia(ctx, { buffer: Buffer.alloc(5 * 1024 * 1024 + 1), mime: 'image/png' }),
      ).rejects.toBeInstanceOf(PermanentProviderError);
    });
  });

  describe('publishItem', () => {
    it('publishes a single post with uploaded media and returns its URL', async () => {
      const bodies = captureTweets();
      const ref = await provider.publishItem(ctx, {
        text: 'Hola mundo',
        media: [png, { id: '777' }],
      });

      expect(ref).toEqual({ id: '101', url: 'https://x.com/omero_dev/status/101' });
      expect(bodies).toHaveLength(1);
      const body = bodies[0] as { text: string; media: { media_ids: string[] }; reply?: unknown };
      expect(body.text).toBe('Hola mundo');
      expect(body.media.media_ids).toHaveLength(2);
      expect(body.media.media_ids[0]).toMatch(/^\d+$/);
      expect(body.media.media_ids[1]).toBe('777');
      expect(body.reply).toBeUndefined();
    });

    it('publishes a reply for thread items', async () => {
      const bodies = captureTweets();
      const first = await provider.publishItem(ctx, { text: '1/2', media: [] });
      const second = await provider.publishItem(ctx, { text: '2/2', media: [] }, first);

      expect(bodies[0]).toEqual({ text: '1/2' });
      expect(bodies[1]).toEqual({ text: '2/2', reply: { in_reply_to_tweet_id: first.id } });
      expect(second.url).toBe(`https://x.com/omero_dev/status/${second.id}`);
    });

    it('refuses more than 4 images', async () => {
      const media = Array.from({ length: 5 }, (_, i) => ({ id: String(i) }));
      await expect(provider.publishItem(ctx, { text: 'x', media })).rejects.toMatchObject({
        code: 'TOO_MANY_IMAGES',
      });
    });
  });

  describe('fetchMetrics', () => {
    it('batches 150 ids into 2 requests of at most 100 and maps public_metrics', async () => {
      const calls: string[][] = [];
      server.use(
        http.get(`${X_API_BASE}/2/tweets`, ({ request }) => {
          const params = new URL(request.url).searchParams;
          expect(params.get('tweet.fields')).toBe('public_metrics');
          const ids = params.get('ids')!.split(',');
          calls.push(ids);
          return HttpResponse.json({
            data: ids.map((id) => ({
              id,
              text: 't',
              public_metrics: {
                impression_count: 1000,
                like_count: 10,
                retweet_count: 3,
                reply_count: 2,
                quote_count: 1,
                bookmark_count: 4,
              },
            })),
          });
        }),
      );
      const refs: RemoteRef[] = Array.from({ length: 150 }, (_, i) => ({
        id: String(1_900_000 + i),
        url: '',
      }));
      const snapshots = await provider.fetchMetrics(ctx, refs);

      expect(calls.map((c) => c.length)).toEqual([100, 50]);
      expect(snapshots).toHaveLength(150);
      expect(snapshots[0]).toMatchObject({
        remoteId: '1900000',
        impressions: 1000,
        likes: 10,
        reposts: 3,
        replies: 2,
        quotes: 1,
        bookmarks: 4,
      });
    });

    it('omits posts that X no longer returns', async () => {
      server.use(
        http.get(`${X_API_BASE}/2/tweets`, () =>
          HttpResponse.json({
            data: [{ id: '1', text: 't', public_metrics: { like_count: 1 } }],
            errors: [
              {
                resource_id: '2',
                resource_type: 'tweet',
                title: 'Not Found Error',
                type: 'https://api.x.com/2/problems/resource-not-found',
                detail: 'Could not find tweet with ids: [2].',
              },
            ],
          }),
        ),
      );
      const out = await provider.fetchMetrics(ctx, [
        { id: '1', url: '' },
        { id: '2', url: '' },
      ]);
      expect(out.map((s) => s.remoteId)).toEqual(['1']);
    });
  });

  describe('error classification', () => {
    const publishWith = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      server.use(
        http.post(`${X_API_BASE}/2/tweets`, () =>
          HttpResponse.json(body as object, { status, headers }),
        ),
      );
      return thrown(provider.publishItem(ctx, { text: 'x', media: [] }));
    };

    it('429 is retryable and honours x-rate-limit-reset', async () => {
      const reset = Math.floor(Date.now() / 1000) + 60;
      const err = await publishWith(
        429,
        {
          title: 'Too Many Requests',
          detail: 'Too Many Requests',
          type: 'about:blank',
          status: 429,
        },
        { 'x-rate-limit-reset': String(reset), 'x-rate-limit-remaining': '0' },
      );
      expect(err).toBeInstanceOf(RetryableProviderError);
      expect(provider.classifyError(err)).toBe('retryable');
      const retryAfterMs = (err as RetryableProviderError).retryAfterMs!;
      expect(retryAfterMs).toBeGreaterThan(55_000);
      expect(retryAfterMs).toBeLessThanOrEqual(60_000);
    });

    it('429 usage-capped (credits exhausted) is permanent', async () => {
      const err = await publishWith(429, {
        title: 'UsageCapExceeded',
        detail: 'Usage cap exceeded: Monthly product cap',
        type: 'https://api.x.com/2/problems/usage-capped',
      });
      expect(provider.classifyError(err)).toBe('permanent');
      expect(err).toMatchObject({ code: 'X_USAGE_CAPPED' });
    });

    it.each([500, 502, 503, 504])('%i is retryable', async (status) => {
      const err = await publishWith(status, { title: 'Service Unavailable' });
      expect(provider.classifyError(err)).toBe('retryable');
      expect(err).toMatchObject({ code: 'UPSTREAM_ERROR', status });
    });

    it('network errors are retryable', async () => {
      server.use(http.post(`${X_API_BASE}/2/tweets`, () => HttpResponse.error()));
      const err = await thrown(provider.publishItem(ctx, { text: 'x', media: [] }));
      expect(provider.classifyError(err)).toBe('retryable');
      expect(err).toMatchObject({ code: 'NETWORK_ERROR' });
    });

    it('401 requires reauth', async () => {
      const err = await publishWith(401, {
        title: 'Unauthorized',
        type: 'about:blank',
        status: 401,
        detail: 'Unauthorized',
      });
      expect(err).toBeInstanceOf(ReauthRequired);
      expect(provider.classifyError(err)).toBe('auth');
    });

    it('403 duplicate content is permanent with a clear code', async () => {
      const err = await publishWith(403, {
        detail: 'You are not allowed to create a Tweet with duplicate content.',
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
      });
      expect(provider.classifyError(err)).toBe('permanent');
      expect(err).toMatchObject({ code: 'DUPLICATE_CONTENT', status: 403 });
      expect((err as Error).message).toMatch(/duplicate/i);
    });

    it('other 403 policy errors are permanent', async () => {
      const err = await publishWith(403, {
        title: 'Client Forbidden',
        type: 'https://api.x.com/2/problems/client-forbidden',
        detail: 'This request must be made using an approved developer account.',
      });
      expect(provider.classifyError(err)).toBe('permanent');
      expect(err).toMatchObject({ code: 'X_CLIENT_FORBIDDEN' });

      const other = await publishWith(403, { title: 'Forbidden', detail: 'Reply not allowed.' });
      expect(other).toMatchObject({ code: 'FORBIDDEN' });
    });

    it('400 validation errors are permanent', async () => {
      const err = await publishWith(400, {
        errors: [{ parameters: { text: [''] }, message: 'The `text` field is too long.' }],
        title: 'Invalid Request',
        detail: 'One or more parameters to your request was invalid.',
        type: 'https://api.x.com/2/problems/invalid-request',
      });
      expect(provider.classifyError(err)).toBe('permanent');
      expect(err).toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
    });

    it('unknown non-provider errors are permanent', () => {
      expect(provider.classifyError(new Error('bug'))).toBe('permanent');
    });

    it('never puts tokens in error messages', async () => {
      const err = (await publishWith(401, {})) as Error;
      expect(err.message).not.toContain(ctx.tokens.accessToken);
    });
  });
});
