import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app';

describe('GET /api/v1/health', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ env: { WORKERS_ENABLED: 'false' } });
  });
  afterAll(async () => {
    await t?.close();
  });

  it('returns 200 with db and redis ok', async () => {
    const res = await t.http().get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      checks: { db: { status: 'ok' }, redis: { status: 'ok' } },
    });
  });

  it('sets security headers (helmet) and a request id', async () => {
    const res = await t.http().get('/api/v1/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('serves the OpenAPI document with the problem details schema', async () => {
    const res = await t.http().get('/api/v1/openapi.json').expect(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.paths['/api/v1/health'].get.responses).toHaveProperty('200');
    expect(res.body.paths['/api/v1/health'].get.responses.default.content).toHaveProperty(
      'application/problem+json',
    );
    expect(res.body.components.schemas).toHaveProperty('ProblemDetails');
    expect(res.body.components.schemas).toHaveProperty('HealthDto_Output');
  });
});

describe('GET /api/v1/health with Redis down', () => {
  let t: TestApp;

  beforeAll(async () => {
    // Nothing listens on port 1: the Redis client keeps retrying in the background.
    t = await createTestApp({
      env: { WORKERS_ENABLED: 'false', REDIS_URL: 'redis://127.0.0.1:1/1' },
    });
  });
  afterAll(async () => {
    await t?.close();
  });

  it('returns 503 and names the failing dependency without leaking details', async () => {
    const res = await t.http().get('/api/v1/health').expect(503);
    expect(res.body).toMatchObject({
      status: 'error',
      checks: { db: { status: 'ok' }, redis: { status: 'error' } },
    });
    expect(['unreachable', 'timeout']).toContain(res.body.checks.redis.error);
  });
});
