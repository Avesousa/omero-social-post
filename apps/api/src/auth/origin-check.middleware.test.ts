import { describe, expect, it } from 'vitest';
import { isSameOriginRequest } from './origin-check.middleware';

const APP = 'https://omero.example.ts.net';

describe('isSameOriginRequest', () => {
  it('lets safe methods through regardless of headers', () => {
    expect(isSameOriginRequest('GET', { origin: 'https://evil.example' }, APP)).toBe(true);
    expect(isSameOriginRequest('HEAD', {}, APP)).toBe(true);
    expect(isSameOriginRequest('OPTIONS', {}, APP)).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post'])('checks %s', (method) => {
    expect(isSameOriginRequest(method, { origin: APP }, APP)).toBe(true);
    expect(isSameOriginRequest(method, { origin: 'https://evil.example' }, APP)).toBe(false);
    expect(isSameOriginRequest(method, {}, APP)).toBe(false);
  });

  it('prefers Origin over Referer', () => {
    expect(
      isSameOriginRequest('POST', { origin: 'https://evil.example', referer: `${APP}/x` }, APP),
    ).toBe(false);
  });

  it('falls back to the Referer origin', () => {
    expect(isSameOriginRequest('POST', { referer: `${APP}/calendar?x=1` }, APP)).toBe(true);
    expect(isSameOriginRequest('POST', { referer: 'https://evil.example/' }, APP)).toBe(false);
    expect(isSameOriginRequest('POST', { referer: 'not a url' }, APP)).toBe(false);
  });

  it('rejects look-alike origins and the opaque "null" origin', () => {
    expect(isSameOriginRequest('POST', { origin: `${APP}.evil.example` }, APP)).toBe(false);
    expect(isSameOriginRequest('POST', { origin: 'http://omero.example.ts.net' }, APP)).toBe(false);
    expect(isSameOriginRequest('POST', { origin: 'null' }, APP)).toBe(false);
  });
});
