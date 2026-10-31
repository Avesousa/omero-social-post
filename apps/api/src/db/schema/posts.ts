import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { channels } from './channels';
import { createdAt, id, tstz, updatedAt } from './columns';
import {
  attemptOutcomeEnum,
  deliveryItemStatusEnum,
  deliveryStatusEnum,
  postStatusEnum,
  scheduledViaEnum,
} from './enums';
import { media } from './media';

export const posts = pgTable(
  'posts',
  {
    id: id(),
    baseContent: text('base_content').notNull().default(''),
    status: postStatusEnum('status').notNull().default('draft'),
    scheduledAt: tstz('scheduled_at'),
    scheduledVia: scheduledViaEnum('scheduled_via'),
    publishedAt: tstz('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Optimistic locking and BullMQ job staleness guard (`jobId = post:{id}:v{version}`). */
    version: integer('version').notNull().default(1),
  },
  (t) => [
    // Calendar range queries and the reconciler.
    index('posts_status_scheduled_at_idx').on(t.status, t.scheduledAt),
    index('posts_scheduled_at_idx').on(t.scheduledAt),
  ],
);

/** One row per post x channel. */
export const deliveries = pgTable(
  'deliveries',
  {
    id: id(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    // Channels are soft-disconnected (status), never deleted while deliveries reference them.
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'restrict' }),
    /** false: items are regenerated from `posts.base_content` on every save. */
    customized: boolean('customized').notNull().default(false),
    status: deliveryStatusEnum('status').notNull().default('pending'),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    /** Set when the owner must act (channel disconnected, interrupted publish, ...). */
    needsAttention: boolean('needs_attention').notNull().default(false),
    publishedAt: tstz('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('deliveries_post_id_channel_id_unique').on(t.postId, t.channelId),
    index('deliveries_post_id_idx').on(t.postId),
    index('deliveries_channel_id_status_idx').on(t.channelId, t.status),
  ],
);

/** A single post is one item; an X thread is N items published in `position` order. */
export const deliveryItems = pgTable(
  'delivery_items',
  {
    id: id(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    text: text('text').notNull().default(''),
    status: deliveryItemStatusEnum('status').notNull().default('pending'),
    remoteId: text('remote_id'),
    remoteUrl: text('remote_url'),
    publishedAt: tstz('published_at'),
  },
  // The unique constraint's index also serves the (delivery_id, position) lookups.
  (t) => [unique('delivery_items_delivery_id_position_unique').on(t.deliveryId, t.position)],
);

export const deliveryItemMedia = pgTable(
  'delivery_item_media',
  {
    deliveryItemId: uuid('delivery_item_id')
      .notNull()
      .references(() => deliveryItems.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ name: 'delivery_item_media_pk', columns: [t.deliveryItemId, t.position] }),
    index('delivery_item_media_media_id_idx').on(t.mediaId),
  ],
);

/** Audit trail: one row per publish attempt of a delivery. */
export const deliveryAttempts = pgTable(
  'delivery_attempts',
  {
    id: id(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull(),
    startedAt: tstz('started_at').notNull().defaultNow(),
    finishedAt: tstz('finished_at'),
    /** Null while the attempt is in progress. */
    outcome: attemptOutcomeEnum('outcome'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
  },
  (t) => [index('delivery_attempts_delivery_id_started_at_idx').on(t.deliveryId, t.startedAt)],
);
