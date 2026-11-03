import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * - `client`: general app use (health, locks, OAuth state, throttling). Commands fail
 *   after a couple of retries so an HTTP request never hangs while Redis is down.
 * - `bullmq`: shared by every BullMQ Queue/Worker. BullMQ requires
 *   `maxRetriesPerRequest: null` so blocking worker commands survive Redis restarts.
 */
export type RedisRole = 'client' | 'bullmq';

/** The single factory every Redis connection in the API goes through. */
export function createRedisConnection(url: string, role: RedisRole): Redis {
  const redis = new Redis(url, {
    connectionName: `omero-api:${role}`,
    maxRetriesPerRequest: role === 'bullmq' ? null : 2,
    connectTimeout: 5_000,
    // Reconnect forever with a capped backoff; the health endpoint reports outages.
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
  });

  // Log the first error of an outage only, not one line per reconnect attempt.
  const logger = new Logger(`Redis:${role}`);
  let healthy = true;
  redis.on('error', (err) => {
    if (!healthy) return;
    healthy = false;
    logger.warn({ err: { message: err.message } }, 'Redis connection error; reconnecting');
  });
  redis.on('ready', () => {
    if (!healthy) logger.log('Redis connection restored');
    healthy = true;
  });
  return redis;
}

/**
 * Closes a connection: graceful QUIT when connected, otherwise a hard disconnect
 * (a QUIT queued on a reconnecting client would wait for Redis to come back).
 */
export async function closeRedis(redis: Redis): Promise<void> {
  if (redis.status === 'end') return;
  if (redis.status !== 'ready') {
    redis.disconnect();
    return;
  }
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}
