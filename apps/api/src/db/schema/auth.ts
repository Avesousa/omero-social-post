import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tstz, updatedAt } from './columns';

/** Single owner today, modelled as a table to allow multi-user later. */
export const users = pgTable('users', {
  id: id(),
  username: text('username').notNull().unique(),
  /** argon2id hash. */
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** sha256 (hex) of the random 256-bit cookie token; the raw token is never stored. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: tstz('expires_at').notNull(),
    lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);
