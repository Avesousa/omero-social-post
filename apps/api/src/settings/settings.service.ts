import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_MISSED_GRACE_MINUTES,
  type Settings,
  settingsSchema,
  timezoneSchema,
} from '@omero/shared';
import { inArray, sql } from 'drizzle-orm';
import { type Database, DRIZZLE } from '../db/db.module';
import { settings } from '../db/schema';

/** Used until the owner saves a timezone (the web sends the browser's on first setup). */
export const DEFAULT_TIMEZONE = 'UTC';

const SETTING_KEYS = ['timezone', 'missedGraceMinutes'] as const;

/** Owner settings over the `settings` key/value table, with defaults for unset keys. */
@Injectable()
export class SettingsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async get(): Promise<Settings> {
    const rows = await this.db
      .select()
      .from(settings)
      .where(inArray(settings.key, [...SETTING_KEYS]));
    const stored = new Map(rows.map((r) => [r.key, r.value]));

    // A malformed stored value falls back to its default instead of breaking reads.
    const timezone = timezoneSchema.safeParse(stored.get('timezone'));
    const grace = settingsSchema.shape.missedGraceMinutes.safeParse(
      stored.get('missedGraceMinutes'),
    );
    return {
      timezone: timezone.success ? timezone.data : DEFAULT_TIMEZONE,
      missedGraceMinutes: grace.success ? grace.data : DEFAULT_MISSED_GRACE_MINUTES,
    };
  }

  async getTimezone(): Promise<string> {
    return (await this.get()).timezone;
  }

  async getMissedGraceMinutes(): Promise<number> {
    return (await this.get()).missedGraceMinutes;
  }

  /** Upserts every key of an already validated settings object. */
  async update(input: Settings): Promise<Settings> {
    await this.db
      .insert(settings)
      .values(SETTING_KEYS.map((key) => ({ key, value: input[key] })))
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: sql`excluded.value`, updatedAt: new Date() },
      });
    return this.get();
  }
}
