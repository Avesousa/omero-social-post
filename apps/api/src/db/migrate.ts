import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

/**
 * Arbitrary but fixed advisory lock id shared by every API process.
 * Holding it makes concurrent boots apply migrations exactly once.
 */
export const MIGRATION_LOCK_ID = 7_301_884_102;

export interface MigrationResult {
  applied: number;
  total: number;
}

interface MigrationLogger {
  log(message: string): void;
}

/**
 * Locates `apps/api/drizzle` from both `src/db` (tests, ts) and `dist/src/db` (build).
 */
export function resolveMigrationsFolder(from = __dirname): string {
  let dir = from;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'drizzle');
    if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`Could not find the drizzle migrations folder above ${from}`);
}

/**
 * Applies pending migrations while holding a session-level Postgres advisory lock.
 * A second process blocks on the lock, then finds nothing left to apply.
 */
export async function runMigrations(
  databaseUrl: string,
  logger: MigrationLogger = console,
  migrationsFolder = resolveMigrationsFolder(),
): Promise<MigrationResult> {
  const client = new Client({ connectionString: databaseUrl, application_name: 'omero-migrator' });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    try {
      const before = await countApplied(client);
      await migrate(drizzle(client), { migrationsFolder });
      const total = await countApplied(client);
      const applied = total - before;
      logger.log(
        applied > 0
          ? `Applied ${applied} database migration(s); ${total} in total`
          : `Database schema up to date (${total} migration(s))`,
      );
      return { applied, total };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    }
  } finally {
    await client.end();
  }
}

async function countApplied(client: Client): Promise<number> {
  const exists = await client.query<{ present: boolean }>(
    `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`,
  );
  if (!exists.rows[0]?.present) return 0;
  const res = await client.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
  );
  return res.rows[0]?.n ?? 0;
}
