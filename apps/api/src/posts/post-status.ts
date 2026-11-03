import { type DeliveryStatus, type PostStatus } from '../db/schema';

/** Statuses in which the post content may still be edited (PUT /posts/:id). */
export const EDITABLE_POST_STATUSES = [
  'draft',
  'scheduled',
] as const satisfies readonly PostStatus[];
/** Statuses in which a post may be deleted. */
export const DELETABLE_POST_STATUSES = [
  'draft',
  'scheduled',
  'failed',
  'missed',
] as const satisfies readonly PostStatus[];

export function isEditable(status: PostStatus): boolean {
  return (EDITABLE_POST_STATUSES as readonly PostStatus[]).includes(status);
}

export function isDeletable(status: PostStatus): boolean {
  return (DELETABLE_POST_STATUSES as readonly PostStatus[]).includes(status);
}

/**
 * Post-level status derived from its deliveries, once publishing has started
 * (the publish worker calls it after each delivery finishes):
 * - any delivery still in flight (`publishing`, or `pending` not started yet) -> `publishing`;
 * - all published -> `published`;
 * - some published, the rest failed/missed -> `partially_published`;
 * - none published and all missed -> `missed`;
 * - none published otherwise (failed, or failed + missed) -> `failed`.
 *
 * Throws for an empty list: a post always has at least one delivery before it can be
 * scheduled, so an empty list is a caller bug.
 */
export function derivePostStatus(
  deliveries: ReadonlyArray<{ status: DeliveryStatus }>,
): PostStatus {
  if (deliveries.length === 0) {
    throw new RangeError('derivePostStatus needs at least one delivery');
  }
  const statuses = deliveries.map((d) => d.status);

  if (statuses.some((s) => s === 'publishing' || s === 'pending')) return 'publishing';

  const published = statuses.filter((s) => s === 'published').length;
  if (published === statuses.length) return 'published';
  if (published > 0) return 'partially_published';
  if (statuses.every((s) => s === 'missed')) return 'missed';
  return 'failed';
}
