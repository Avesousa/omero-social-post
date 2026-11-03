import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/msw/server';
import {
  classifyProviderError,
  PermanentProviderError,
  ReauthRequired,
  RetryableProviderError,
} from './provider-errors';
import { chunk, providerFetch, retryAfterHeaderMs } from './provider-http';

const URL_SLOW = 'https://api.x.com/2/slow';
const URL_DOWN = 'https://api.x.com/2/down';

describe('providerFetch', () => {
  it('maps a timeout to a retryable TIMEOUT error', async () => {
    server.use(
      http.get(URL_SLOW, async () => {
        await delay(500);
        return HttpResponse.json({});
      }),
    );
    const err = await providerFetch('x', URL_SLOW, { timeoutMs: 50 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RetryableProviderError);
    expect(err).toMatchObject({ code: 'TIMEOUT', provider: 'x' });
  });

  it('maps a network error to a retryable NETWORK_ERROR error', async () => {
    server.use(http.get(URL_DOWN, () => HttpResponse.error()));
    const err = await providerFetch('linkedin', URL_DOWN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RetryableProviderError);
    expect(err).toMatchObject({ code: 'NETWORK_ERROR', provider: 'linkedin' });
  });

  it('returns HTTP error responses untouched for the adapter to map', async () => {
    server.use(http.get(URL_DOWN, () => HttpResponse.json({}, { status: 503 })));
    const res = await providerFetch('x', URL_DOWN);
    expect(res.status).toBe(503);
  });
});

describe('helpers', () => {
  it('parses Retry-After seconds and dates', () => {
    expect(retryAfterHeaderMs(new Response(null, { headers: { 'retry-after': '3' } }))).toBe(3000);
    const now = Date.parse('2026-10-28T12:00:00Z');
    const res = new Response(null, { headers: { 'retry-after': 'Wed, 28 Oct 2026 12:00:10 GMT' } });
    expect(retryAfterHeaderMs(res, now)).toBe(10_000);
    expect(retryAfterHeaderMs(new Response(null))).toBeUndefined();
  });

  it('chunks arrays', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('classifies typed errors and treats unknown errors as permanent', () => {
    expect(
      classifyProviderError(new RetryableProviderError('x', { code: 'A', message: 'a' })),
    ).toBe('retryable');
    expect(classifyProviderError(new ReauthRequired('x', { code: 'A', message: 'a' }))).toBe(
      'auth',
    );
    expect(
      classifyProviderError(new PermanentProviderError('x', { code: 'A', message: 'a' })),
    ).toBe('permanent');
    expect(classifyProviderError(new TypeError('boom'))).toBe('permanent');
  });
});
