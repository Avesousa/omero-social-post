import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { type Redis } from 'ioredis';

export interface RedisLockHandle {
  readonly key: string;
  readonly token: string;
}

export interface AcquireOptions {
  /** How long to keep retrying before giving up (0 = single attempt). */
  waitMs?: number;
  /** Delay between attempts while waiting. */
  retryDelayMs?: number;
}

export class LockNotAcquiredError extends Error {
  constructor(readonly lockName: string) {
    super(`Could not acquire lock "${lockName}"`);
    this.name = 'LockNotAcquiredError';
  }
}

/** Deletes the key only if it still holds our token, so we never free someone else's lock. */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

/**
 * Single-instance Redis mutex (`SET key token NX PX ttl` + compare-and-delete release).
 * Used to serialize per-key work across processes, e.g. OAuth token refresh per channel.
 *
 * The TTL is a safety net for crashed holders: keep the guarded work well below it,
 * because the lock silently expires if the work outlives the TTL.
 */
export class RedisLock {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'omero:lock:',
  ) {}

  async acquire(
    name: string,
    ttlMs: number,
    { waitMs = 0, retryDelayMs = 100 }: AcquireOptions = {},
  ): Promise<RedisLockHandle | null> {
    const key = this.prefix + name;
    const token = randomBytes(16).toString('hex');
    const deadline = Date.now() + waitMs;
    for (;;) {
      const ok = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
      if (ok === 'OK') return { key, token };
      if (Date.now() + retryDelayMs > deadline) return null;
      await sleep(retryDelayMs);
    }
  }

  /** @returns true if the lock was still ours and has been released. */
  async release(handle: RedisLockHandle): Promise<boolean> {
    const deleted = await this.redis.eval(RELEASE_SCRIPT, 1, handle.key, handle.token);
    return deleted === 1;
  }

  /** Runs `fn` while holding the lock; throws {@link LockNotAcquiredError} if it cannot be taken. */
  async withLock<T>(
    name: string,
    ttlMs: number,
    fn: () => Promise<T>,
    options?: AcquireOptions,
  ): Promise<T> {
    const handle = await this.acquire(name, ttlMs, options);
    if (!handle) throw new LockNotAcquiredError(name);
    try {
      return await fn();
    } finally {
      await this.release(handle);
    }
  }
}
