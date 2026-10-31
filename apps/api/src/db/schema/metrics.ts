import { index, integer, jsonb, pgTable, uuid } from 'drizzle-orm/pg-core';
import { id, tstz } from './columns';
import { metricsCheckpointEnum } from './enums';
import { deliveryItems } from './posts';

export const postMetrics = pgTable(
  'post_metrics',
  {
    id: id(),
    deliveryItemId: uuid('delivery_item_id')
      .notNull()
      .references(() => deliveryItems.id, { onDelete: 'cascade' }),
    checkpoint: metricsCheckpointEnum('checkpoint').notNull(),
    fetchedAt: tstz('fetched_at').notNull().defaultNow(),
    impressions: integer('impressions'),
    likes: integer('likes'),
    reposts: integer('reposts'),
    replies: integer('replies'),
    quotes: integer('quotes'),
    bookmarks: integer('bookmarks'),
    /** Untouched provider payload, for fields we do not model yet. */
    raw: jsonb('raw'),
  },
  (t) => [
    index('post_metrics_delivery_item_id_fetched_at_idx').on(t.deliveryItemId, t.fetchedAt.desc()),
  ],
);
