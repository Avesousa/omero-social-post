import { type DefaultJobOptions } from 'bullmq';

/** BullMQ queue names. Inject a queue with `@InjectQueue(QUEUE.publish) queue: Queue`. */
export const QUEUE = {
  publish: 'publish',
  metrics: 'metrics',
  maintenance: 'maintenance',
  notify: 'notify',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export const QUEUE_NAMES: readonly QueueName[] = Object.values(QUEUE);

/** Job names per the technical spec's scheduling design. */
export const JOB = {
  /** publish: parent job, delayed until `scheduled_at`, `jobId = post:{id}:v{version}`. */
  publishPost: 'publish-post',
  /** publish: child job, one per delivery. */
  publishDelivery: 'publish-delivery',
  /** metrics: `jobId = metrics:{itemId}:{checkpoint}`. */
  fetchMetrics: 'fetch-metrics',
  /** maintenance: repeatable every 5 min (Job Scheduler) and on boot. */
  reconcile: 'reconcile',
  /** maintenance: repeatable daily. */
  tokenExpiryCheck: 'token-expiry-check',
  /** notify: Telegram sendMessage. */
  telegram: 'telegram',
  /** maintenance: does nothing; used by health tooling and the test harness. */
  noop: 'noop',
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

/** Redis key prefix for every BullMQ key (never use ioredis `keyPrefix` with BullMQ). */
export const BULLMQ_PREFIX = 'omero';

/**
 * Defaults applied to every queue. Retries are opt-in per job (`attempts`), because
 * publishing must never be retried blindly. Retention keeps Redis well under 128 MB.
 */
export const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 30 * 24 * 3600, count: 5000 },
};

/** Bull Board UI path, relative to the global `/api/v1` prefix. */
export const BULL_BOARD_ROUTE = '/admin/queues';
