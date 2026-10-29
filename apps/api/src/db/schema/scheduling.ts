import { sql } from 'drizzle-orm';
import { boolean, check, jsonb, pgTable, smallint, text, time, unique } from 'drizzle-orm/pg-core';
import { id, updatedAt } from './columns';

/** Weekly publishing slots, interpreted in the owner's `timezone` setting. */
export const queueSlots = pgTable(
  'queue_slots',
  {
    id: id(),
    /** 0 = Sunday ... 6 = Saturday (same as `Date#getDay`). */
    weekday: smallint('weekday').notNull(),
    /** Wall-clock time, e.g. '09:00:00'. */
    localTime: time('local_time').notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [
    unique('queue_slots_weekday_local_time_unique').on(t.weekday, t.localTime),
    check('queue_slots_weekday_check', sql`${t.weekday} BETWEEN 0 AND 6`),
  ],
);

/** Key/value settings. Known keys: `timezone`, `missedGraceMinutes` (default 360). */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
});
