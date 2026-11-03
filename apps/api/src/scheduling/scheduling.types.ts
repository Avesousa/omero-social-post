import { type JobsOptions } from 'bullmq';

/**
 * Payloads and ids of the jobs on the `publish` queue (see technical spec, "Scheduling design").
 *
 * Postgres is the source of truth: every job carries only ids and the post `version` it
 * was created for, and re-reads the database before acting.
 */

/** `publish-post`: delayed until `scheduled_at`. Starts the publish flow. */
export interface PublishPostJobData {
  postId: string;
  /** `posts.version` this job was enqueued for; a different current version means stale. */
  version: number;
}

/** `publish-delivery`: one child per delivery (plugged in by T024). */
export interface PublishDeliveryJobData {
  postId: string;
  deliveryId: string;
  /** The post version the flow was started for. */
  version: number;
}

/** `publish-post-finalize`: flow parent; runs after every delivery child has ended. */
export interface PublishPostFinalizeJobData {
  postId: string;
  version: number;
}

/*
 * Job ids use `_` as separator. The spec writes `post:{id}:v{version}`, but BullMQ 6.5 only
 * tolerates a `:` in a custom id when it splits into exactly 3 parts (a legacy carve-out
 * for repeatable jobs, flagged "to be replaced" in its source), so `:` is not a safe bet.
 * UUIDs contain no `_`, so ids stay unambiguous and parseable.
 */

/** Id of the delayed parent job. A new version always means a new id. */
export function publishPostJobId(postId: string, version: number): string {
  return `post_${postId}_v${version}`;
}

/** Id of a delivery child job. */
export function publishDeliveryJobId(deliveryId: string, version: number): string {
  return `delivery_${deliveryId}_v${version}`;
}

/** Id of the flow parent that closes a publish run. */
export function publishFinalizeJobId(postId: string, version: number): string {
  return `finalize_${postId}_v${version}`;
}

const DAY_S = 24 * 3600;

/** Retention for scheduling jobs; Redis stays tiny (128 MB budget). */
export const PUBLISH_JOB_RETENTION = {
  removeOnComplete: { age: 3 * DAY_S, count: 500 },
  removeOnFail: { age: 30 * DAY_S, count: 1000 },
} satisfies Pick<JobsOptions, 'removeOnComplete' | 'removeOnFail'>;

/** Delivery children: 3 attempts, exponential backoff with a 2 min base. */
export const PUBLISH_DELIVERY_ATTEMPTS = 3;
export const PUBLISH_DELIVERY_BACKOFF = { type: 'exponential', delay: 120_000 } as const;

/**
 * The parent only orchestrates and is idempotent (the status/version gate makes a re-run
 * a no-op), so it may be retried if Redis hiccups while the flow is being created.
 */
export const PUBLISH_POST_ATTEMPTS = 3;
export const PUBLISH_POST_BACKOFF = { type: 'fixed', delay: 5_000 } as const;
