import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate';
import { testInfra } from '../setup/test-env';

const silent = { log: () => undefined };

/** Runs against a throwaway database so it can migrate from scratch. */
describe('runMigrations', () => {
  const dbName = `omero_test_mig_${randomBytes(4).toString('hex')}`;
  let adminUrl: string;
  let freshUrl: string;

  beforeAll(async () => {
    const base = new URL(testInfra().databaseUrl);
    adminUrl = base.toString();
    base.pathname = `/${dbName}`;
    freshUrl = base.toString();
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    await admin.end();
  });

  afterAll(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.end();
  });

  it('applies migrations exactly once when two processes boot concurrently', async () => {
    const results = await Promise.all([
      runMigrations(freshUrl, silent),
      runMigrations(freshUrl, silent),
    ]);
    const applied = results.map((r) => r.applied).sort();
    expect(applied[0]).toBe(0);
    expect(applied[1]).toBeGreaterThan(0);
    expect(results[0]!.total).toBe(results[1]!.total);

    const again = await runMigrations(freshUrl, silent);
    expect(again.applied).toBe(0);
  });

  it('creates every table and the indexes from the technical spec', async () => {
    const client = new Client({ connectionString: freshUrl });
    await client.connect();
    try {
      const tables = await client.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      );
      expect(tables.rows.map((r) => r.tablename)).toEqual([
        'channels',
        'deliveries',
        'delivery_attempts',
        'delivery_item_media',
        'delivery_items',
        'media',
        'notifications',
        'post_metrics',
        'posts',
        'queue_slots',
        'sessions',
        'settings',
        'users',
      ]);

      const indexes = await client.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`,
      );
      const defs = Object.fromEntries(indexes.rows.map((r) => [r.indexname, r.indexdef]));
      expect(defs.posts_status_scheduled_at_idx).toContain('(status, scheduled_at)');
      expect(defs.posts_scheduled_at_idx).toContain('(scheduled_at)');
      expect(defs.deliveries_post_id_idx).toContain('(post_id)');
      expect(defs.deliveries_channel_id_status_idx).toContain('(channel_id, status)');
      expect(defs.delivery_items_delivery_id_position_unique).toContain(
        '(delivery_id, "position")',
      );
      expect(defs.post_metrics_delivery_item_id_fetched_at_idx).toContain('fetched_at DESC');
      expect(defs.notifications_read_at_created_at_idx).toContain('created_at DESC');
    } finally {
      await client.end();
    }
  });
});
