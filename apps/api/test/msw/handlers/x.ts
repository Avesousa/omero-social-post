import { http, type HttpHandler, HttpResponse } from 'msw';
import { X_API_BASE } from '../../../src/providers/x/x.constants';

export { X_API_BASE };

/** Realistic X API v2 payloads (shapes from docs.x.com, values made up). */
export const X_FIXTURES = {
  user: {
    id: '1500000000000000001',
    username: 'omero_dev',
    name: 'Omero Dev',
    profile_image_url: 'https://pbs.twimg.com/profile_images/1500000000000000001/avatar_normal.jpg',
  },
  token: {
    token_type: 'bearer',
    expires_in: 7200,
    access_token: 'x-access-token-1',
    scope: 'tweet.read tweet.write users.read media.write offline.access',
    refresh_token: 'x-refresh-token-1',
  },
  /** Refresh token the default handler treats as revoked. */
  revokedRefreshToken: 'x-revoked-refresh-token',
  /** Authorization code the default handler treats as invalid/expired. */
  badCode: 'x-bad-code',
} as const;

let seq = 0;
/** Numeric snowflake-like ids, unique per test run. */
export function nextXId(): string {
  seq += 1;
  return (1880000000000000000n + BigInt(seq)).toString();
}

function hasBearer(request: Request): boolean {
  return /^Bearer \S+/.test(request.headers.get('authorization') ?? '');
}

const unauthorized = () =>
  HttpResponse.json(
    { title: 'Unauthorized', type: 'about:blank', status: 401, detail: 'Unauthorized' },
    { status: 401 },
  );

/**
 * Default happy-path X handlers, active in every test. Override per case with
 * `server.use(http.post(`${X_API_BASE}/2/tweets`, ...))`.
 */
export const xHandlers: HttpHandler[] = [
  http.post(`${X_API_BASE}/2/oauth2/token`, async ({ request }) => {
    if (!request.headers.get('authorization')?.startsWith('Basic ')) {
      return HttpResponse.json(
        { error: 'unauthorized_client', error_description: 'Missing valid authorization header' },
        { status: 401 },
      );
    }
    const form = new URLSearchParams(await request.text());
    if (form.get('grant_type') === 'authorization_code') {
      if (form.get('code') === X_FIXTURES.badCode || !form.get('code_verifier')) {
        return HttpResponse.json(
          {
            error: 'invalid_request',
            error_description: 'Value passed for the authorization code was invalid.',
          },
          { status: 400 },
        );
      }
      return HttpResponse.json(X_FIXTURES.token);
    }
    if (form.get('grant_type') === 'refresh_token') {
      const refreshToken = form.get('refresh_token') ?? '';
      if (refreshToken === X_FIXTURES.revokedRefreshToken) {
        return HttpResponse.json(
          {
            error: 'invalid_request',
            error_description: 'Value passed for the token was invalid.',
          },
          { status: 400 },
        );
      }
      // X rotates refresh tokens on every refresh.
      const n = nextXId();
      return HttpResponse.json({
        ...X_FIXTURES.token,
        access_token: `x-access-token-${n}`,
        refresh_token: `x-refresh-token-${n}`,
      });
    }
    return HttpResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  }),

  http.get(`${X_API_BASE}/2/users/me`, ({ request }) =>
    hasBearer(request) ? HttpResponse.json({ data: X_FIXTURES.user }) : unauthorized(),
  ),

  http.post(`${X_API_BASE}/2/media/upload`, async ({ request }) => {
    if (!hasBearer(request)) return unauthorized();
    const form = await request.formData();
    const media = form.get('media');
    if (!(media instanceof Blob) || !form.get('media_category')) {
      return HttpResponse.json(
        {
          title: 'Invalid Request',
          type: 'https://api.x.com/2/problems/invalid-request',
          detail: 'media is required',
        },
        { status: 400 },
      );
    }
    const id = nextXId();
    return HttpResponse.json({
      data: {
        id,
        media_key: `3_${id}`,
        size: media.size,
        expires_after_secs: 86400,
        image: { image_type: media.type, w: 1200, h: 675 },
      },
    });
  }),

  http.post(`${X_API_BASE}/2/tweets`, async ({ request }) => {
    if (!hasBearer(request)) return unauthorized();
    const body = (await request.json()) as { text?: string };
    const id = nextXId();
    return HttpResponse.json(
      { data: { id, text: body.text ?? '', edit_history_post_ids: [id] } },
      { status: 201 },
    );
  }),

  http.get(`${X_API_BASE}/2/tweets`, ({ request }) => {
    if (!hasBearer(request)) return unauthorized();
    const ids = (new URL(request.url).searchParams.get('ids') ?? '').split(',').filter(Boolean);
    return HttpResponse.json({
      data: ids.map((id, i) => ({
        id,
        text: `post ${id}`,
        edit_history_post_ids: [id],
        public_metrics: {
          retweet_count: i,
          reply_count: 1,
          like_count: 10 + i,
          quote_count: 0,
          bookmark_count: 2,
          impression_count: 1000 + i,
        },
      })),
      meta: { result_count: ids.length },
    });
  }),
];
