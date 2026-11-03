import { z } from 'zod';

const versionSchema = z.int().nonnegative();

/** Body of `POST /posts/:id/schedule`. `at` is an ISO 8601 timestamp; the API rejects past times. */
export const schedulePostSchema = z.object({
  at: z.iso.datetime({ offset: true }),
  version: versionSchema,
});
export type SchedulePostInput = z.infer<typeof schedulePostSchema>;

/** Body of version-guarded post actions (`queue`, `publish-now`). */
export const versionedActionSchema = z.object({
  version: versionSchema,
});
export type VersionedActionInput = z.infer<typeof versionedActionSchema>;

/** Body of `POST /posts/:id/queue`. */
export const queuePostSchema = versionedActionSchema;
export type QueuePostInput = VersionedActionInput;

/** Body of `POST /posts/:id/publish-now`. */
export const publishNowSchema = versionedActionSchema;
export type PublishNowInput = VersionedActionInput;

/** Response of `POST /posts/:id/queue`. */
export const queuePostResultSchema = z.object({
  scheduledAt: z.iso.datetime({ offset: true }),
});
export type QueuePostResult = z.infer<typeof queuePostResultSchema>;
