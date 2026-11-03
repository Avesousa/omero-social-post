import { z } from 'zod';

// Canonical enum values shared by the database schema, the API and the web.
// The tuples are `as const` so they can feed Drizzle `pgEnum` and `z.enum` directly.

export const POST_STATUSES = [
  'draft',
  'scheduled',
  'publishing',
  'published',
  'partially_published',
  'failed',
  'missed',
] as const;
export const postStatusSchema = z.enum(POST_STATUSES);
export type PostStatus = z.infer<typeof postStatusSchema>;

export const DELIVERY_STATUSES = [
  'pending',
  'publishing',
  'published',
  'failed',
  'missed',
] as const;
export const deliveryStatusSchema = z.enum(DELIVERY_STATUSES);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

export const DELIVERY_ITEM_STATUSES = ['pending', 'published', 'failed'] as const;
export const deliveryItemStatusSchema = z.enum(DELIVERY_ITEM_STATUSES);
export type DeliveryItemStatus = z.infer<typeof deliveryItemStatusSchema>;

export const CHANNEL_STATUSES = ['connected', 'needs_reconnect', 'disconnected'] as const;
export const channelStatusSchema = z.enum(CHANNEL_STATUSES);
export type ChannelStatus = z.infer<typeof channelStatusSchema>;

export const SCHEDULED_VIA = ['manual', 'queue', 'now'] as const;
export const scheduledViaSchema = z.enum(SCHEDULED_VIA);
export type ScheduledVia = z.infer<typeof scheduledViaSchema>;

export const METRICS_CHECKPOINTS = ['1h', '24h', '7d', 'manual'] as const;
export const metricsCheckpointSchema = z.enum(METRICS_CHECKPOINTS);
export type MetricsCheckpoint = z.infer<typeof metricsCheckpointSchema>;

export const NOTIFICATION_TYPES = [
  'delivery_failed',
  'channel_reauth',
  'token_expiring',
  'post_missed',
] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof notificationTypeSchema>;
