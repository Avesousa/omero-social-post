import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { buildBaseLoggerOptions } from './logger.options';
import { REDACTED, redactSensitiveKeys, redactUrl } from './redaction';

function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  const logger = pino(buildBaseLoggerOptions({ LOG_LEVEL: 'info', NODE_ENV: 'test' }), stream);
  return { logger, lines };
}

describe('log redaction', () => {
  it('redacts auth headers on requests and set-cookie on responses', () => {
    const { logger, lines } = captureLogger();
    logger.info(
      {
        req: {
          method: 'GET',
          url: '/api/v1/channels/x/callback?code=abc123&state=xyz&foo=bar',
          headers: { authorization: 'Bearer abc', cookie: 'sid=secret', accept: 'json' },
        },
        res: { statusCode: 200, headers: { 'set-cookie': ['sid=secret'], 'content-type': 'json' } },
      },
      'request completed',
    );
    const out = JSON.parse(lines[0]!);
    expect(out.req.headers).toEqual({ authorization: REDACTED, cookie: REDACTED, accept: 'json' });
    expect(out.res.headers['set-cookie']).toBe(REDACTED);
    expect(out.res.headers['content-type']).toBe('json');
    expect(out.req.url).toBe(
      `/api/v1/channels/x/callback?code=${encodeURIComponent(REDACTED)}&state=${encodeURIComponent(REDACTED)}&foo=bar`,
    );
    expect(lines[0]).not.toContain('abc123');
    expect(lines[0]).not.toContain('secret');
  });

  it('redacts token/password/secret fields at any depth', () => {
    const { logger, lines } = captureLogger();
    logger.info({
      channel: { id: 'c1', accessToken: 'at', refresh_token: 'rt', nested: { clientSecret: 's' } },
      user: { password: 'p', username: 'owner' },
      list: [{ apiToken: 'x' }],
    });
    const out = JSON.parse(lines[0]!);
    expect(out.channel).toEqual({
      id: 'c1',
      accessToken: REDACTED,
      refresh_token: REDACTED,
      nested: { clientSecret: REDACTED },
    });
    expect(out.user).toEqual({ password: REDACTED, username: 'owner' });
    expect(out.list).toEqual([{ apiToken: REDACTED }]);
  });

  it('does not mutate the logged object or walk class instances', () => {
    const payload = { token: 'keep-me', when: new Date(0), err: new Error('boom') };
    const copy = redactSensitiveKeys(payload);
    expect(payload.token).toBe('keep-me');
    expect(copy.token).toBe(REDACTED);
    expect(copy.when).toBe(payload.when);
    expect(copy.err).toBe(payload.err);
  });

  it('leaves URLs without sensitive params untouched', () => {
    expect(redactUrl('/api/v1/posts?from=1&to=2')).toBe('/api/v1/posts?from=1&to=2');
    expect(redactUrl('/api/v1/health')).toBe('/api/v1/health');
  });
});
