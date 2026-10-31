import { http, type HttpHandler, HttpResponse } from 'msw';
import {
  LINKEDIN_API_BASE,
  LINKEDIN_WWW_BASE,
} from '../../../src/providers/linkedin/linkedin.constants';

export { LINKEDIN_API_BASE };
/** LinkedIn OAuth endpoints (`/oauth/v2/accessToken`) and image upload URLs (`/dms-uploads/...`). */
export const LINKEDIN_OAUTH_BASE = LINKEDIN_WWW_BASE;

/** Realistic LinkedIn payloads (shapes from learn.microsoft.com, values made up). */
export const LINKEDIN_FIXTURES = {
  userinfo: {
    sub: 'Ab1Cd2Ef3G',
    name: 'Omero Dev',
    given_name: 'Omero',
    family_name: 'Dev',
    picture: 'https://media.licdn.com/dms/image/v2/C4E03AQ/profile-displayphoto-shrink_100_100/0/1',
    locale: { country: 'AR', language: 'es' },
  },
  token: {
    access_token: 'li-access-token-1',
    expires_in: 5_183_999,
    scope: 'openid,profile,w_member_social',
    token_type: 'Bearer',
    id_token: 'eyJhbGciOiJSUzI1NiJ9.e30.signature',
  },
  badCode: 'li-bad-code',
  revokedRefreshToken: 'li-revoked-refresh-token',
} as const;

let seq = 0;
function nextId(): string {
  seq += 1;
  return (7390000000000000000n + BigInt(seq)).toString();
}

const restError = (status: number, code: string, message: string) =>
  HttpResponse.json({ status, code, message, serviceErrorCode: 0 }, { status });

function checkRest(request: Request): Response | undefined {
  if (!/^Bearer \S+/.test(request.headers.get('authorization') ?? '')) {
    return restError(401, 'EMPTY_ACCESS_TOKEN', 'Empty oauth2 access token');
  }
  if (!/^\d{6}$/.test(request.headers.get('linkedin-version') ?? '')) {
    return restError(
      400,
      'VERSION_MISSING',
      'A version must be present. Please specify a version by adding the LinkedIn-Version header.',
    );
  }
  if (request.headers.get('x-restli-protocol-version') !== '2.0.0') {
    return restError(400, 'INVALID_PROTOCOL', 'X-Restli-Protocol-Version 2.0.0 is required');
  }
  return undefined;
}

/** Default happy-path LinkedIn handlers, active in every test. Override per test with `server.use`. */
export const linkedinHandlers: HttpHandler[] = [
  http.post(`${LINKEDIN_WWW_BASE}/oauth/v2/accessToken`, async ({ request }) => {
    const form = new URLSearchParams(await request.text());
    if (!form.get('client_id') || !form.get('client_secret')) {
      return HttpResponse.json(
        {
          error: 'invalid_request',
          error_description: 'A required parameter "client_id" is missing',
        },
        { status: 400 },
      );
    }
    if (form.get('grant_type') === 'authorization_code') {
      if (form.get('code') === LINKEDIN_FIXTURES.badCode) {
        return HttpResponse.json(
          {
            error: 'invalid_request',
            error_description: 'Unable to retrieve access token: authorization code not found',
          },
          { status: 401 },
        );
      }
      return HttpResponse.json(LINKEDIN_FIXTURES.token);
    }
    if (form.get('grant_type') === 'refresh_token') {
      if (form.get('refresh_token') === LINKEDIN_FIXTURES.revokedRefreshToken) {
        return HttpResponse.json(
          {
            error: 'invalid_request',
            error_description:
              'The provided authorization grant or refresh token is invalid, expired or revoked.',
          },
          { status: 400 },
        );
      }
      return HttpResponse.json({
        ...LINKEDIN_FIXTURES.token,
        access_token: `li-access-token-${nextId()}`,
        refresh_token: form.get('refresh_token'),
        refresh_token_expires_in: 25_000_000,
      });
    }
    return HttpResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  }),

  http.get(`${LINKEDIN_API_BASE}/v2/userinfo`, ({ request }) =>
    /^Bearer \S+/.test(request.headers.get('authorization') ?? '')
      ? HttpResponse.json(LINKEDIN_FIXTURES.userinfo)
      : restError(401, 'EMPTY_ACCESS_TOKEN', 'Empty oauth2 access token'),
  ),

  http.post(`${LINKEDIN_API_BASE}/rest/images`, async ({ request }) => {
    const invalid = checkRest(request);
    if (invalid) return invalid;
    if (new URL(request.url).searchParams.get('action') !== 'initializeUpload') {
      return restError(400, 'INVALID_ACTION', 'Unknown action');
    }
    const body = (await request.json()) as { initializeUploadRequest?: { owner?: string } };
    if (!body.initializeUploadRequest?.owner?.startsWith('urn:li:person:')) {
      return restError(400, 'INVALID_URN_TYPE', 'owner must be a person URN');
    }
    const id = `D4E10AQ${nextId()}`;
    return HttpResponse.json({
      value: {
        uploadUrlExpiresAt: Date.now() + 3_600_000,
        uploadUrl: `${LINKEDIN_WWW_BASE}/dms-uploads/${id}/uploaded-image/0?ca=vector_feedshare&cn=uploads&sync=1&v=beta&ut=abc`,
        image: `urn:li:image:${id}`,
      },
    });
  }),

  http.put(`${LINKEDIN_WWW_BASE}/dms-uploads/*`, ({ request }) =>
    /^Bearer \S+/.test(request.headers.get('authorization') ?? '')
      ? new HttpResponse(null, { status: 201 })
      : new HttpResponse(null, { status: 401 }),
  ),

  http.post(`${LINKEDIN_API_BASE}/rest/posts`, async ({ request }) => {
    const invalid = checkRest(request);
    if (invalid) return invalid;
    const body = (await request.json()) as { author?: string; commentary?: string };
    if (!body.author || body.commentary === undefined) {
      return restError(400, 'MISSING_FIELD', 'Field /author is required');
    }
    return new HttpResponse(null, {
      status: 201,
      headers: { 'x-restli-id': `urn:li:share:${nextId()}` },
    });
  }),
];
