import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testInfra } from '../../test/setup/test-env';
import { OAuthStateError, OAuthStateStore, pkceFromVerifier } from './oauth-state.store';

describe('OAuthStateStore', () => {
  let redis: Redis;
  let store: OAuthStateStore;

  beforeAll(() => {
    redis = new Redis(testInfra().redisUrl);
    store = new OAuthStateStore(redis);
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('creates an S256 PKCE pair and a 10 minute state', async () => {
    const created = await store.create('x', 'session-1', '/settings/channels');
    expect(created.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expected = createHash('sha256').update(created.codeVerifier).digest('base64url');
    expect(created.codeChallenge).toBe(expected);
    expect(created.pkce).toEqual(pkceFromVerifier(created.codeVerifier));

    const ttl = await redis.ttl(`omero:oauth:state:${created.state}`);
    expect(ttl).toBeGreaterThan(590);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  it('returns the stored data once, then rejects the same state (single use)', async () => {
    const created = await store.create('linkedin', 'session-2', '/settings/channels');
    const data = await store.consume(created.state, 'session-2', 'linkedin');
    expect(data).toMatchObject({
      provider: 'linkedin',
      sessionId: 'session-2',
      codeVerifier: created.codeVerifier,
      redirectAfter: '/settings/channels',
    });
    await expect(store.consume(created.state, 'session-2')).rejects.toMatchObject({
      reason: 'unknown_or_expired',
    });
  });

  it('rejects unknown state', async () => {
    await expect(store.consume('does-not-exist', 'session-1')).rejects.toBeInstanceOf(
      OAuthStateError,
    );
    await expect(store.consume('', 'session-1')).rejects.toBeInstanceOf(OAuthStateError);
  });

  it('rejects expired state', async () => {
    const created = await store.create('x', 'session-3', undefined, 1);
    await sleep(1_100);
    await expect(store.consume(created.state, 'session-3')).rejects.toMatchObject({
      reason: 'unknown_or_expired',
    });
  });

  it('rejects a state bound to another session and burns it', async () => {
    const created = await store.create('x', 'session-4');
    await expect(store.consume(created.state, 'attacker-session')).rejects.toMatchObject({
      reason: 'session_mismatch',
    });
    // Burnt: even the right session cannot use it afterwards.
    await expect(store.consume(created.state, 'session-4')).rejects.toMatchObject({
      reason: 'unknown_or_expired',
    });
  });

  it('rejects a state created for another provider', async () => {
    const created = await store.create('x', 'session-5');
    await expect(store.consume(created.state, 'session-5', 'linkedin')).rejects.toMatchObject({
      reason: 'provider_mismatch',
    });
  });

  it('drops redirect targets that are not same-origin relative paths', async () => {
    for (const target of ['https://evil.example', '//evil.example', '/\\evil.example']) {
      const created = await store.create('x', 'session-6', target);
      const data = await store.consume(created.state, 'session-6');
      expect(data.redirectAfter).toBeUndefined();
    }
  });
});
