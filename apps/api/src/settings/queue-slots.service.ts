import { Inject, Injectable } from '@nestjs/common';
import { type QueueSlot, type QueueSlots } from '@omero/shared';
import { and, asc, gt, inArray, isNotNull, lte } from 'drizzle-orm';
import { type Database, DRIZZLE } from '../db/db.module';
import { posts, queueSlots } from '../db/schema';
import { nextFreeSlot, QUEUE_HORIZON_DAYS } from '../scheduling/next-free-slot';
import { SettingsService } from './settings.service';

/** The app database or an open transaction, so callers can read inside their own tx. */
export type DbExecutor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/** Post statuses whose `scheduled_at` occupies a queue slot. */
const SLOT_TAKING_STATUSES = ['scheduled', 'publishing'] as const;

const DAY_MS = 24 * 3_600_000;

@Injectable()
export class QueueSlotsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  /** All weekly slots, ordered by weekday then time, with times as "HH:mm". */
  async list(db: DbExecutor = this.db): Promise<QueueSlot[]> {
    const rows = await db
      .select()
      .from(queueSlots)
      .orderBy(asc(queueSlots.weekday), asc(queueSlots.localTime));
    return rows.map((r) => ({
      weekday: r.weekday,
      localTime: r.localTime.slice(0, 5),
      enabled: r.enabled,
    }));
  }

  /** Replaces the whole weekly set atomically. Input is already validated (no duplicates). */
  async replace(slots: QueueSlots): Promise<QueueSlot[]> {
    return this.db.transaction(async (tx) => {
      await tx.delete(queueSlots);
      if (slots.length > 0) {
        await tx.insert(queueSlots).values(
          slots.map((s) => ({
            weekday: s.weekday,
            localTime: `${s.localTime}:00`,
            enabled: s.enabled,
          })),
        );
      }
      return this.list(tx);
    });
  }

  /** `scheduled_at` of every post that occupies a slot between `from` and `to`. */
  async takenTimes(from: Date, to: Date, db: DbExecutor = this.db): Promise<Date[]> {
    const rows = await db
      .select({ scheduledAt: posts.scheduledAt })
      .from(posts)
      .where(
        and(
          inArray(posts.status, [...SLOT_TAKING_STATUSES]),
          isNotNull(posts.scheduledAt),
          // Minute-precision match: include the minute `from` falls in.
          gt(posts.scheduledAt, new Date(from.getTime() - 60_000)),
          lte(posts.scheduledAt, to),
        ),
      );
    return rows.map((r) => r.scheduledAt!);
  }

  /**
   * Next free queue slot after `now` in the owner's timezone, or null when none exists
   * within 30 days (callers map that to NO_FREE_SLOT). Pass `db` to read inside a
   * transaction, e.g. while assigning the slot to a post.
   */
  async findNextFreeSlot({
    now = new Date(),
    db = this.db,
  }: { now?: Date; db?: DbExecutor } = {}): Promise<Date | null> {
    const [timezone, slots, takenTimes] = await Promise.all([
      this.settings.getTimezone(),
      this.list(db),
      this.takenTimes(now, new Date(now.getTime() + (QUEUE_HORIZON_DAYS + 1) * DAY_MS), db),
    ]);
    return nextFreeSlot({ now, timezone, slots, takenTimes });
  }
}
