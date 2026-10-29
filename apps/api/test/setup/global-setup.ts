import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../../src/db/migrate';
import {
  assertDisposable,
  flushRedisDb,
  LOCAL_DATABASE_URL,
  LOCAL_REDIS_URL,
  recreateDatabaseSchema,
  type TestInfra,
} from './infra';

/** Match production majors (see infra/docker-compose.dev.yml). */
const POSTGRES_IMAGE = 'postgres:17-alpine';
const REDIS_IMAGE = 'redis:8-alpine';

/**
 * Resolves Postgres + Redis for the whole run, in this order:
 *   1. TEST_DATABASE_URL / TEST_REDIS_URL (CI service containers, custom setups);
 *   2. Testcontainers, when a Docker daemon is reachable;
 *   3. local services: postgres://omero:omero@127.0.0.1:5432/omero_test and
 *      redis://127.0.0.1:6379/1 (e.g. `pnpm infra:up`).
 * Set TEST_CONTAINERS=false to skip step 2.
 * Then recreates the schema, applies migrations once and flushes the Redis test DB.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const started: Array<StartedPostgreSqlContainer | StartedRedisContainer> = [];
  const infra = await resolveInfra(started);
  assertDisposable(infra);

  await recreateDatabaseSchema(infra.databaseUrl);
  await runMigrations(infra.databaseUrl, { log: () => undefined });
  await flushRedisDb(infra.redisUrl);

  console.warn(`[test] using ${infra.source} services (db ${redact(infra.databaseUrl)})`);
  project.provide('testInfra', infra);

  return async () => {
    await Promise.all(started.map((c) => c.stop()));
  };
}

async function resolveInfra(
  started: Array<StartedPostgreSqlContainer | StartedRedisContainer>,
): Promise<TestInfra> {
  const envDb = process.env.TEST_DATABASE_URL;
  const envRedis = process.env.TEST_REDIS_URL;
  if (envDb || envRedis) {
    return {
      databaseUrl: envDb ?? LOCAL_DATABASE_URL,
      redisUrl: envRedis ?? LOCAL_REDIS_URL,
      source: 'env',
    };
  }

  if (process.env.TEST_CONTAINERS !== 'false') {
    try {
      const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
      const { RedisContainer } = await import('@testcontainers/redis');
      const [pg, redis] = await Promise.all([
        new PostgreSqlContainer(POSTGRES_IMAGE)
          .withDatabase('omero_test')
          .withUsername('omero')
          .withPassword('omero')
          .start(),
        new RedisContainer(REDIS_IMAGE).start(),
      ]);
      started.push(pg, redis);
      return {
        databaseUrl: pg.getConnectionUri(),
        redisUrl: `${redis.getConnectionUrl()}/1`,
        source: 'testcontainers',
      };
    } catch (err) {
      await Promise.allSettled(started.map((c) => c.stop()));
      started.length = 0;
      console.warn(
        `[test] Testcontainers unavailable (${firstLine(err)}); falling back to local services`,
      );
    }
  }

  return { databaseUrl: LOCAL_DATABASE_URL, redisUrl: LOCAL_REDIS_URL, source: 'local' };
}

function firstLine(err: unknown): string {
  return String(err instanceof Error ? err.message : err).split('\n')[0] ?? 'unknown error';
}

function redact(url: string): string {
  const u = new URL(url);
  if (u.password) u.password = '***';
  return u.toString();
}
