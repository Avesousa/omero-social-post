import { Client } from 'pg';
import { Redis } from 'ioredis';

/** Connection info shared from global setup to every test file via `inject('testInfra')`. */
export interface TestInfra {
  databaseUrl: string;
  redisUrl: string;
  /** Where the services come from, for diagnostics. */
  source: 'env' | 'testcontainers' | 'local';
}

declare module 'vitest' {
  interface ProvidedContext {
    testInfra: TestInfra;
  }
}

export const LOCAL_DATABASE_URL = 'postgres://omero:omero@127.0.0.1:5432/omero_test';
/** Redis DB index 1 keeps test keys away from dev data in DB 0. */
export const LOCAL_REDIS_URL = 'redis://127.0.0.1:6379/1';

/**
 * Refuses to wipe anything that does not look like a disposable test target, so a
 * mis-set TEST_DATABASE_URL can never truncate a dev or production database.
 */
export function assertDisposable(infra: TestInfra): void {
  if (infra.source === 'testcontainers') return;
  const dbName = new URL(infra.databaseUrl).pathname.slice(1);
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to reset database "${dbName}": test database names must contain "test".`,
    );
  }
  const redisDb = Number(new URL(infra.redisUrl).pathname.slice(1) || '0');
  if (redisDb === 0) {
    throw new Error('Refusing to flush Redis DB 0 in tests: use a non-zero DB index, e.g. /1.');
  }
}

/** Drops and recreates the schemas so every run migrates a pristine database. */
export async function recreateDatabaseSchema(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
}

export async function flushRedisDb(redisUrl: string): Promise<void> {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}
