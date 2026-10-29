import {
  channelStatusSchema,
  deliveryItemStatusSchema,
  deliveryStatusSchema,
  metricsCheckpointSchema,
  POST_STATUSES,
  postInputSchema,
  postStatusSchema,
  providerIdSchema,
  scheduledViaSchema,
} from '@omero/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ATTEMPT_OUTCOMES } from '../db/schema';

// No `.meta({ id })` on DTO root schemas (see CONVENTIONS.md).

const isoDateTime = z.iso.datetime({ offset: true });

/* ----------------------------------- input ---------------------------------- */

/** Body of `POST /posts`: a new draft. `version` is ignored on create. */
export class CreatePostDto extends createZodDto(postInputSchema) {}

/** Body of `PUT /posts/:id`: same as create, plus the version the client last saw. */
export const updatePostSchema = postInputSchema.extend({ version: z.int().positive() });
export class UpdatePostDto extends createZodDto(updatePostSchema) {}

export class PostIdParamDto extends createZodDto(z.object({ id: z.uuid() })) {}

/** Calendar range bound: an ISO 8601 datetime with offset, or a plain date (UTC midnight). */
const rangeBound = z.union([isoDateTime, z.iso.date()]);

export const listPostsQuerySchema = z.object({
  /** Inclusive start of the range. */
  from: rangeBound,
  /** Exclusive end of the range; at most 62 days after `from`. */
  to: rangeBound,
  /** Optional filter: one status or a comma-separated list, e.g. `scheduled,published`. */
  status: z
    .string()
    .refine(
      (value) =>
        value.split(',').every((s) => (POST_STATUSES as readonly string[]).includes(s.trim())),
      { message: `must be a comma-separated list of: ${POST_STATUSES.join(', ')}` },
    )
    .optional(),
});
export class ListPostsQueryDto extends createZodDto(listPostsQuerySchema) {}

/* ---------------------------------- output ---------------------------------- */

const channelSummarySchema = z.object({
  id: z.uuid(),
  provider: providerIdSchema,
  handle: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  status: channelStatusSchema,
});

const itemMediaSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  mime: z.string(),
  width: z.int().nullable(),
  height: z.int().nullable(),
});

const metricsSnapshotSchema = z.object({
  checkpoint: metricsCheckpointSchema,
  fetchedAt: isoDateTime,
  impressions: z.int().nullable(),
  likes: z.int().nullable(),
  reposts: z.int().nullable(),
  replies: z.int().nullable(),
  quotes: z.int().nullable(),
  bookmarks: z.int().nullable(),
});

const deliveryItemSchema = z.object({
  id: z.uuid(),
  position: z.int(),
  text: z.string(),
  status: deliveryItemStatusSchema,
  remoteId: z.string().nullable(),
  remoteUrl: z.string().nullable(),
  publishedAt: isoDateTime.nullable(),
  media: z.array(itemMediaSchema),
  /** Most recent metrics snapshot (X only); null until the first fetch. */
  latestMetrics: metricsSnapshotSchema.nullable(),
});

const deliveryAttemptSchema = z.object({
  id: z.uuid(),
  attempt: z.int(),
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
  outcome: z.enum(ATTEMPT_OUTCOMES).nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});

const deliveryDetailSchema = z.object({
  id: z.uuid(),
  channelId: z.uuid(),
  customized: z.boolean(),
  status: deliveryStatusSchema,
  needsAttention: z.boolean(),
  lastErrorCode: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  publishedAt: isoDateTime.nullable(),
  channel: channelSummarySchema,
  items: z.array(deliveryItemSchema),
  /** Latest first. */
  attempts: z.array(deliveryAttemptSchema),
});

export const postDetailSchema = z.object({
  id: z.uuid(),
  status: postStatusSchema,
  baseContent: z.string(),
  /** Base images, as attached to the first item of the non-customized deliveries. */
  baseMediaIds: z.array(z.uuid()),
  scheduledAt: isoDateTime.nullable(),
  scheduledVia: scheduledViaSchema.nullable(),
  publishedAt: isoDateTime.nullable(),
  /** Send it back on PUT and on scheduling actions (optimistic locking). */
  version: z.int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deliveries: z.array(deliveryDetailSchema),
});
export type PostDetail = z.infer<typeof postDetailSchema>;
export class PostDetailDto extends createZodDto(postDetailSchema) {}

const deliverySummarySchema = z.object({
  id: z.uuid(),
  channelId: z.uuid(),
  provider: providerIdSchema,
  status: deliveryStatusSchema,
  needsAttention: z.boolean(),
});

const postSummarySchema = z.object({
  id: z.uuid(),
  status: postStatusSchema,
  scheduledAt: isoDateTime.nullable(),
  scheduledVia: scheduledViaSchema.nullable(),
  publishedAt: isoDateTime.nullable(),
  version: z.int(),
  /** First 140 characters of the base content. */
  preview: z.string(),
  deliveries: z.array(deliverySummarySchema),
});
export type PostSummary = z.infer<typeof postSummarySchema>;

export const postListSchema = z.object({
  /** Ordered by effective time (`publishedAt`, else `scheduledAt`), then id. */
  items: z.array(postSummarySchema),
});
export type PostList = z.infer<typeof postListSchema>;
export class PostListDto extends createZodDto(postListSchema) {}
