import { pgEnum } from 'drizzle-orm/pg-core';

// Enum values are part of the shared contract with `@omero/shared` and the web.
// Changing or reordering them requires a migration and a coordinated contract change.

export const PROVIDERS = ['x', 'linkedin'] as const;
export const CHANNEL_STATUSES = ['connected', 'needs_reconnect', 'disconnected'] as const;
export const POST_STATUSES = [
  'draft',
  'scheduled',
  'publishing',
  'published',
  'partially_published',
  'failed',
  'missed',
] as const;
export const SCHEDULED_VIA = ['manual', 'queue', 'now'] as const;
export const DELIVERY_STATUSES = [
  'pending',
  'publishing',
  'published',
  'failed',
  'missed',
] as const;
export const DELIVERY_ITEM_STATUSES = ['pending', 'published', 'failed'] as const;
export const ATTEMPT_OUTCOMES = [
  'success',
  'retryable_error',
  'auth_error',
  'permanent_error',
  'interrupted',
] as const;
export const METRICS_CHECKPOINTS = ['1h', '24h', '7d', 'manual'] as const;
export const NOTIFICATION_TYPES = [
  'delivery_failed',
  'channel_reauth',
  'token_expiring',
  'post_missed',
] as const;
/** Free-text column (not a pg enum) so new levels need no migration. */
export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'error'] as const;

export type Provider = (typeof PROVIDERS)[number];
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];
export type PostStatus = (typeof POST_STATUSES)[number];
export type ScheduledVia = (typeof SCHEDULED_VIA)[number];
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export type DeliveryItemStatus = (typeof DELIVERY_ITEM_STATUSES)[number];
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];
export type MetricsCheckpoint = (typeof METRICS_CHECKPOINTS)[number];
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const providerEnum = pgEnum('provider', PROVIDERS);
export const channelStatusEnum = pgEnum('channel_status', CHANNEL_STATUSES);
export const postStatusEnum = pgEnum('post_status', POST_STATUSES);
export const scheduledViaEnum = pgEnum('scheduled_via', SCHEDULED_VIA);
export const deliveryStatusEnum = pgEnum('delivery_status', DELIVERY_STATUSES);
export const deliveryItemStatusEnum = pgEnum('delivery_item_status', DELIVERY_ITEM_STATUSES);
export const attemptOutcomeEnum = pgEnum('attempt_outcome', ATTEMPT_OUTCOMES);
export const metricsCheckpointEnum = pgEnum('metrics_checkpoint', METRICS_CHECKPOINTS);
export const notificationTypeEnum = pgEnum('notification_type', NOTIFICATION_TYPES);
