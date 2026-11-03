import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { type Database } from '../../src/db/db.module';
import * as schema from '../../src/db/schema';
import { testInfra } from '../setup/test-env';

let tables: string[] | undefined;

/**
 * Empties every application table (keeps the schema and migration history).
 * Call it in `beforeEach` of integration suites that write data.
 */
export async function resetDb(db: Database): Promise<void> {
  if (!tables) {
    const result = await db.execute<{ tablename: string }>(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    tables = result.rows.map((r) => r.tablename);
  }
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t}"`).join(', ');
  await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
}

/**
 * A standalone drizzle instance on the test database, for tests that do not need the
 * whole Nest app (e.g. pure repository/factory tests). Close it with `close()`.
 */
export function createTestDb(): { db: Database; close: () => Promise<void> } {
  const pool = new Pool({ connectionString: testInfra().databaseUrl, max: 2 });
  return { db: drizzle({ client: pool, schema }), close: () => pool.end() };
}
