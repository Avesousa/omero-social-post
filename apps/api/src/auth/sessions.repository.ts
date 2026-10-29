import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { type Database, DRIZZLE } from '../db/db.module';
import { sessions } from '../db/schema';

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;

@Injectable()
export class SessionsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insert(values: NewSessionRow): Promise<SessionRow> {
    const [row] = await this.db.insert(sessions).values(values).returning();
    return row!;
  }

  async findById(id: string): Promise<SessionRow | undefined> {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    return row;
  }

  /**
   * Slides the expiry. Conditional on `last_seen_at` still being older than `staleBefore`,
   * so concurrent requests renewing the same session write at most once.
   */
  async renew(id: string, now: Date, expiresAt: Date, staleBefore: Date): Promise<boolean> {
    const rows = await this.db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt })
      .where(and(eq(sessions.id, id), lt(sessions.lastSeenAt, staleBefore)))
      .returning({ id: sessions.id });
    return rows.length > 0;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }

  /** Housekeeping for rows nobody presents again. TODO: call from the maintenance queue. */
  async deleteExpired(now: Date): Promise<number> {
    const rows = await this.db
      .delete(sessions)
      .where(lt(sessions.expiresAt, now))
      .returning({ id: sessions.id });
    return rows.length;
  }
}
