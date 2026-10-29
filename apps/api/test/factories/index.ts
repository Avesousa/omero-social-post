import { type Database } from '../../src/db/db.module';
import { channels, deliveries, deliveryItems, posts } from '../../src/db/schema';
import { testCipher } from '../setup/test-env';

/**
 * Minimal valid rows with overridable fields. Missing parents are created on the
 * fly, so `await createDeliveryItem(db)` yields a full post -> delivery -> item chain.
 * Values are unique per call so tests can create several rows without collisions.
 */

export type Channel = typeof channels.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Delivery = typeof deliveries.$inferSelect;
export type DeliveryItem = typeof deliveryItems.$inferSelect;

let seq = 0;
const next = () => ++seq;

const HOUR = 3_600_000;

export async function createChannel(
  db: Database,
  overrides: Partial<typeof channels.$inferInsert> = {},
): Promise<Channel> {
  const n = next();
  const cipher = testCipher();
  const [row] = await db
    .insert(channels)
    .values({
      provider: 'x',
      externalId: `ext-${n}`,
      handle: `account${n}`,
      displayName: `Account ${n}`,
      status: 'connected',
      accessTokenEnc: cipher.encrypt(`access-token-${n}`),
      refreshTokenEnc: cipher.encrypt(`refresh-token-${n}`),
      tokenExpiresAt: new Date(Date.now() + 2 * HOUR),
      scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
      ...overrides,
    })
    .returning();
  return row!;
}

export async function createPost(
  db: Database,
  overrides: Partial<typeof posts.$inferInsert> = {},
): Promise<Post> {
  const n = next();
  const [row] = await db
    .insert(posts)
    .values({ baseContent: `Post number ${n}`, status: 'draft', ...overrides })
    .returning();
  return row!;
}

/** A post scheduled one hour from now (status `scheduled`, via `manual`). */
export function createScheduledPost(
  db: Database,
  overrides: Partial<typeof posts.$inferInsert> = {},
): Promise<Post> {
  return createPost(db, {
    status: 'scheduled',
    scheduledAt: new Date(Date.now() + HOUR),
    scheduledVia: 'manual',
    ...overrides,
  });
}

export async function createDelivery(
  db: Database,
  overrides: Partial<typeof deliveries.$inferInsert> = {},
): Promise<Delivery> {
  const postId = overrides.postId ?? (await createPost(db)).id;
  const channelId = overrides.channelId ?? (await createChannel(db)).id;
  const [row] = await db
    .insert(deliveries)
    .values({ status: 'pending', ...overrides, postId, channelId })
    .returning();
  return row!;
}

export async function createDeliveryItem(
  db: Database,
  overrides: Partial<typeof deliveryItems.$inferInsert> = {},
): Promise<DeliveryItem> {
  const deliveryId = overrides.deliveryId ?? (await createDelivery(db)).id;
  const n = next();
  const [row] = await db
    .insert(deliveryItems)
    .values({ position: 0, text: `Item ${n}`, status: 'pending', ...overrides, deliveryId })
    .returning();
  return row!;
}
