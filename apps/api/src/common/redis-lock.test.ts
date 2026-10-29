import { setTimeout as sleep } from 'node:timers/promises';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testInfra } from '../../test/setup/test-env';
import { LockNotAcquiredError, RedisLock } from './redis-lock';

describe('RedisLock', () => {
  let redis: Redis;
  let lock: RedisLock;
  let n = 0;
  const name = () => `test:${process.pid}:${Date.now()}:${++n}`;

  beforeAll(() => {
    redis = new Redis(testInfra().redisUrl);
    lock = new RedisLock(redis);
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('is exclusive until released', async () => {
    const key = name();
    const first = await lock.acquire(key, 5_000);
    expect(first).not.toBeNull();
    expect(await lock.acquire(key, 5_000)).toBeNull();

    expect(await lock.release(first!)).toBe(true);
    const second = await lock.acquire(key, 5_000);
    expect(second).not.toBeNull();
    await lock.release(second!);
  });

  it('sets the TTL with PX so a crashed holder cannot block forever', async () => {
    const key = name();
    const handle = await lock.acquire(key, 80);
    const ttl = await redis.pttl(handle!.key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(80);
    await sleep(120);
    expect(await lock.acquire(key, 1_000)).not.toBeNull();
  });

  it('never releases a lock held by someone else (compare-and-delete)', async () => {
    const key = name();
    const stale = await lock.acquire(key, 50);
    await sleep(80); // expires
    const current = await lock.acquire(key, 5_000);
    expect(await lock.release(stale!)).toBe(false);
    expect(await redis.get(current!.key)).toBe(current!.token);
    await lock.release(current!);
  });

  it('waits for the lock when asked to', async () => {
    const key = name();
    const holder = await lock.acquire(key, 5_000);
    setTimeout(() => void lock.release(holder!), 100);
    const waited = await lock.acquire(key, 5_000, { waitMs: 2_000, retryDelayMs: 20 });
    expect(waited).not.toBeNull();
    await lock.release(waited!);
  });

  it('withLock serializes concurrent critical sections', async () => {
    const key = name();
    const events: string[] = [];
    const task = (id: string) =>
      lock.withLock(
        key,
        5_000,
        async () => {
          events.push(`start:${id}`);
          await sleep(50);
          events.push(`end:${id}`);
          return id;
        },
        { waitMs: 3_000, retryDelayMs: 10 },
      );

    const results = await Promise.all([task('a'), task('b')]);
    expect(results.sort()).toEqual(['a', 'b']);
    // No interleaving: every start is immediately followed by its own end.
    expect(events[1]).toBe(events[0]!.replace('start', 'end'));
    expect(events[3]).toBe(events[2]!.replace('start', 'end'));
    expect(await redis.exists(`omero:lock:${key}`)).toBe(0);
  });

  it('withLock throws LockNotAcquiredError when it cannot get the lock', async () => {
    const key = name();
    const holder = await lock.acquire(key, 5_000);
    await expect(lock.withLock(key, 1_000, async () => 'never')).rejects.toBeInstanceOf(
      LockNotAcquiredError,
    );
    await lock.release(holder!);
  });
});
