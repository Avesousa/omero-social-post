import { ApiError } from './errors';

/**
 * Custom orval mutator: every generated request function goes through here.
 *
 * - URLs come from the OpenAPI paths and are relative (`/api/v1/...`), so the browser
 *   calls the web origin and Next.js rewrites them to the API. The session cookie stays
 *   first-party and no CORS is involved. This also means the client is meant for the
 *   browser (client components); server code has no origin to resolve them against.
 * - `credentials: 'include'` sends the session cookie.
 * - JSON (and problem+json) responses are parsed; 204 / empty bodies resolve to `undefined`.
 * - Non-2xx responses throw an {@link ApiError} carrying the problem details body.
 */
export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json, application/problem+json');

  const response = await fetch(url, { ...init, headers, credentials: 'include' });
  const body = await readBody(response);

  if (!response.ok) {
    throw new ApiError(response.status, body, response.statusText);
  }
  return body as T;
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205 || response.status === 304) {
    return undefined;
  }
  const contentType = response.headers.get('Content-Type') ?? '';
  if (/[/+]json\b/i.test(contentType)) {
    const text = await response.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // A malformed body on an error response must still surface as an ApiError.
      return text;
    }
  }
  if (contentType.startsWith('text/')) return response.text();
  // Binary payloads (for example media files); an absent content type with no body is empty.
  const blob = await response.blob();
  return blob.size === 0 ? undefined : blob;
}

/** Error type orval uses for the generated hooks' `error` field. */
export type ErrorType<_Error> = ApiError;

/** Request body type orval uses for the generated functions and mutations. */
export type BodyType<Body> = Body;
