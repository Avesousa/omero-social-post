import { Inject, Injectable } from '@nestjs/common';
import { count, eq, sql } from 'drizzle-orm';
import { type Database, DRIZZLE } from '../db/db.module';
import { users } from '../db/schema';

export type User = typeof users.$inferSelect;

/** Advisory lock key serializing owner creation (arbitrary constant, unique to this use). */
const SETUP_LOCK_KEY = 7_220_141;

@Injectable()
export class UsersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async count(): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(users);
    return row?.n ?? 0;
  }

  async findByUsername(username: string): Promise<User | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.username, username)).limit(1);
    return row;
  }

  async findById(id: string): Promise<User | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  }

  /**
   * Creates the owner only if no user exists yet, atomically: a transaction-scoped
   * advisory lock serializes concurrent setups, so two parallel requests can never both
   * see an empty table. Returns `undefined` when an owner already exists.
   */
  async createFirstUser(username: string, passwordHash: string): Promise<User | undefined> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`);
      const [existing] = await tx.select({ n: count() }).from(users);
      if ((existing?.n ?? 0) > 0) return undefined;
      const [row] = await tx.insert(users).values({ username, passwordHash }).returning();
      return row;
    });
  }
}
