import { RetryableProviderError } from './provider-errors';
import { type ProviderId } from './provider.types';

/** Default per-request timeout for calls to social networks. */
export const PROVIDER_TIMEOUT_MS = 15_000;

export interface ProviderFetchInit extends RequestInit {
  timeoutMs?: number;
}

/**
 * `fetch` with a timeout. Network failures and timeouts become
 * {@link RetryableProviderError}; HTTP error statuses are returned as-is for the
 * adapter to map, since only the adapter knows what each status means.
 *
 * Note for callers that create content: a timeout does not prove the request
 * failed on the network side (code `TIMEOUT`), so a retry may hit a duplicate.
 */
export async function providerFetch(
  provider: ProviderId,
  url: string | URL,
  { timeoutMs = PROVIDER_TIMEOUT_MS, signal, ...init }: ProviderFetchInit = {},
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    if (timeout.aborted) {
      throw new RetryableProviderError(provider, {
        code: 'TIMEOUT',
        message: `${providerName(provider)} did not answer within ${Math.round(timeoutMs / 1000)} s.`,
        cause: err,
      });
    }
    throw new RetryableProviderError(provider, {
      code: 'NETWORK_ERROR',
      message: `Could not reach ${providerName(provider)} (network error).`,
      cause: err,
    });
  }
}

/** Parses a JSON body without throwing; returns undefined for empty or non-JSON bodies. */
export async function readJson<T = unknown>(res: Response): Promise<T | undefined> {
  const text = await res.text().catch(() => '');
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** `Retry-After` header (seconds or HTTP date) in milliseconds, if present and sane. */
export function retryAfterHeaderMs(res: Response, now = Date.now()): number | undefined {
  const value = res.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** Basic auth header value for OAuth confidential clients. */
export function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

/** Splits an OAuth `scope` string (space-delimited per RFC 6749; LinkedIn uses commas). */
export function parseScopes(scope: unknown): string[] {
  return typeof scope === 'string' ? scope.split(/[\s,]+/).filter(Boolean) : [];
}

/** Absolute expiry from an `expires_in`-style value in seconds. */
export function expiryFromSeconds(seconds: unknown, now = Date.now()): Date | undefined {
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? new Date(now + seconds * 1000)
    : undefined;
}

export function providerName(provider: ProviderId): string {
  return provider === 'x' ? 'X' : 'LinkedIn';
}

/** Splits an array into chunks of at most `size` items. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
