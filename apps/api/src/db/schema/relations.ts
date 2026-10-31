import { relations } from 'drizzle-orm';
import { sessions, users } from './auth';
import { channels } from './channels';
import { media } from './media';
import { postMetrics } from './metrics';
import { deliveries, deliveryAttempts, deliveryItemMedia, deliveryItems, posts } from './posts';

// Relations power drizzle's relational query API (`db.query.posts.findFirst({ with: ... })`).
// They do not change the SQL schema.

export const usersRelations = relations(users, ({ many }) => ({ sessions: many(sessions) }));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const channelsRelations = relations(channels, ({ many }) => ({
  deliveries: many(deliveries),
}));

export const postsRelations = relations(posts, ({ many }) => ({ deliveries: many(deliveries) }));

export const deliveriesRelations = relations(deliveries, ({ one, many }) => ({
  post: one(posts, { fields: [deliveries.postId], references: [posts.id] }),
  channel: one(channels, { fields: [deliveries.channelId], references: [channels.id] }),
  items: many(deliveryItems),
  attempts: many(deliveryAttempts),
}));

export const deliveryItemsRelations = relations(deliveryItems, ({ one, many }) => ({
  delivery: one(deliveries, { fields: [deliveryItems.deliveryId], references: [deliveries.id] }),
  media: many(deliveryItemMedia),
  metrics: many(postMetrics),
}));

export const deliveryItemMediaRelations = relations(deliveryItemMedia, ({ one }) => ({
  item: one(deliveryItems, {
    fields: [deliveryItemMedia.deliveryItemId],
    references: [deliveryItems.id],
  }),
  media: one(media, { fields: [deliveryItemMedia.mediaId], references: [media.id] }),
}));

export const deliveryAttemptsRelations = relations(deliveryAttempts, ({ one }) => ({
  delivery: one(deliveries, {
    fields: [deliveryAttempts.deliveryId],
    references: [deliveries.id],
  }),
}));

export const postMetricsRelations = relations(postMetrics, ({ one }) => ({
  item: one(deliveryItems, {
    fields: [postMetrics.deliveryItemId],
    references: [deliveryItems.id],
  }),
}));

export const mediaRelations = relations(media, ({ many }) => ({ usages: many(deliveryItemMedia) }));
