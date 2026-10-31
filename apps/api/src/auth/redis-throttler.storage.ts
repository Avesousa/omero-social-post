import { type ThrottlerStorage } from '@nestjs/throttler';
import { type Redis } from 'ioredis';
import { THROTTLE_KEY_PREFIX } from './auth.constants';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Fixed-window counter + block key in one round trip.
 * KEYS[1] = hits, KEYS[2] = block; ARGV = ttlMs, limit, blockDurationMs.
 * Returns { hits, hitsPttl, blockPttl }.
 */
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local hitsTtl = redis.call('PTTL', KEYS[1])
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl <= 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blockTtl = tonumber(ARGV[3])
end
return { hits, hitsTtl, blockTtl }
`;

/**
 * Redis-backed storage for @nestjs/throttler, on the app's general Redis client, so
 * limits survive restarts and are shared by every API instance. Times are returned in
 * seconds, like the built-in in-memory storage.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${THROTTLE_KEY_PREFIX}${throttlerName}:${key}`;
    const [hits, hitsTtl, blockTtl] = (await this.redis.eval(
      INCREMENT_SCRIPT,
      2,
      `${base}:hits`,
      `${base}:block`,
      String(ttl),
      String(limit),
      String(blockDuration),
    )) as [number, number, number];
    const isBlocked = blockTtl > 0;
    return {
      totalHits: hits,
      timeToExpire: Math.max(0, Math.ceil(hitsTtl / 1000)),
      isBlocked,
      timeToBlockExpire: isBlocked ? Math.ceil(blockTtl / 1000) : 0,
    };
  }
}
