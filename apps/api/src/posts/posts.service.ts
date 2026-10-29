import { Inject, Injectable } from '@nestjs/common';
import {
  type ChannelContext,
  deriveItems,
  type MediaInfo,
  type PostInput,
  type PostItemInput,
  validatePostInput,
} from '@omero/shared';
import {
  and,
  asc,
  type ExtractTablesWithRelations,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { type PgDatabase } from 'drizzle-orm/pg-core';
import { type ProblemFieldError, ProblemException } from '../common/errors/problem.exception';
import { type Database, DRIZZLE } from '../db/db.module';
import type * as schema from '../db/schema';
import {
  channels,
  deliveries,
  deliveryItemMedia,
  deliveryItems,
  media,
  type PostStatus,
  posts,
  type ScheduledVia,
} from '../db/schema';
import { mediaUrl } from '../media/media.service';
import { derivePostStatus, DELETABLE_POST_STATUSES, EDITABLE_POST_STATUSES } from './post-status';
import { toProblemFieldErrors, VALIDATION_LIMITS } from './post-validation';
import { type PostDetail, type PostList, type PostSummary } from './posts.dto';

/** The app database or a transaction on it: every public method accepts either. */
export type DbExecutor = PgDatabase<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export type PostRow = typeof posts.$inferSelect;

/** Calendar ranges are capped so a request can never scan the whole history. */
export const MAX_RANGE_DAYS = 62;
const DAY_MS = 86_400_000;
const PREVIEW_CHARS = 140;

const VALIDATION_FAILED = 'VALIDATION_FAILED';
const VERSION_CONFLICT = 'VERSION_CONFLICT';
const FORBIDDEN_STATE = 'FORBIDDEN_STATE';

export interface ListPostsQuery {
  from: string;
  to: string;
  status?: string;
}

/** One channel's part of a save, after validation: the exact items to store. */
interface DeliveryPlan {
  channelId: string;
  customized: boolean;
  items: PostItemInput[];
}

export interface TransitionOptions {
  /** The update applies only while the post is in one of these statuses (else 409 FORBIDDEN_STATE). */
  from: readonly PostStatus[];
  /** New status; omit to keep the current one. */
  to?: PostStatus;
  /** The update applies only at this version (else 409 VERSION_CONFLICT). */
  expectedVersion?: number;
  /**
   * Increment `version`. Do it for every change that must invalidate queued jobs
   * (schedule, reschedule, unschedule, publish-now): jobs are keyed `post:{id}:v{version}`.
   */
  bumpVersion?: boolean;
  set?: {
    scheduledAt?: Date | null;
    scheduledVia?: ScheduledVia | null;
    publishedAt?: Date | null;
  };
}

/** What the scheduler and the publish worker need about a post, in one query. */
export interface SchedulingSnapshot {
  post: Pick<
    PostRow,
    'id' | 'status' | 'version' | 'baseContent' | 'scheduledAt' | 'scheduledVia' | 'publishedAt'
  >;
  deliveries: Array<{
    id: string;
    channelId: string;
    customized: boolean;
    status: (typeof deliveries.$inferSelect)['status'];
    needsAttention: boolean;
    channel: Pick<typeof channels.$inferSelect, 'id' | 'provider' | 'status' | 'settings'>;
    /** In publish order. */
    items: Array<{
      id: string;
      position: number;
      text: string;
      status: (typeof deliveryItems.$inferSelect)['status'];
      remoteId: string | null;
      /** In attachment order. */
      mediaIds: string[];
    }>;
  }>;
}

@Injectable()
export class PostsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /* --------------------------------- writes --------------------------------- */

  /** Creates a draft from a `PostInput`. Throws 422 VALIDATION_FAILED with field errors. */
  async create(input: PostInput): Promise<PostDetail> {
    const id = await this.db.transaction(async (tx) => {
      const plan = await this.planDeliveries(tx, input);
      const [post] = await tx
        .insert(posts)
        .values({ baseContent: input.baseContent, status: 'draft' })
        .returning({ id: posts.id });
      await this.writeDeliveries(tx, post!.id, plan);
      return post!.id;
    });
    return this.mustGetDetail(id);
  }

  /**
   * Replaces a post's content from a `PostInput`, at `version`, and increments the version.
   * Only `draft` and `scheduled` posts can be edited; a scheduled post stays scheduled
   * (the scheduler re-enqueues on version change).
   * Errors: 404; 409 FORBIDDEN_STATE; 409 VERSION_CONFLICT; 422 VALIDATION_FAILED.
   */
  async update(id: string, input: PostInput & { version: number }): Promise<PostDetail> {
    await this.db.transaction(async (tx) => {
      // Lock the row first, so state and version errors win over validation errors.
      const [current] = await tx
        .select({ status: posts.status, version: posts.version })
        .from(posts)
        .where(eq(posts.id, id))
        .for('update');
      if (!current) throw ProblemException.notFound('Post not found.');
      assertState(current.status, EDITABLE_POST_STATUSES, 'edited');
      if (current.version !== input.version) throw versionConflict(current.version);

      const plan = await this.planDeliveries(tx, input);
      await tx
        .update(posts)
        .set({ baseContent: input.baseContent, version: sql`${posts.version} + 1` })
        .where(eq(posts.id, id));
      await this.writeDeliveries(tx, id, plan);
    });
    return this.mustGetDetail(id);
  }

  /**
   * Deletes a `draft`, `scheduled`, `failed` or `missed` post with its deliveries, items,
   * attempts and metrics (media rows stay). Returns the deleted row so the caller can
   * drop the queued job (`post:{id}:v{version}`); a stale job is a no-op anyway.
   */
  async delete(id: string, db: DbExecutor = this.db): Promise<PostRow> {
    const [deleted] = await db
      .delete(posts)
      .where(and(eq(posts.id, id), inArray(posts.status, DELETABLE_POST_STATUSES)))
      .returning();
    if (deleted) return deleted;

    const [current] = await db.select({ status: posts.status }).from(posts).where(eq(posts.id, id));
    if (!current) throw ProblemException.notFound('Post not found.');
    throw forbiddenState(current.status, 'deleted');
  }

  /**
   * Conditional status/version change for the scheduling task, e.g. schedule:
   * `transition(id, { from: ['draft', 'scheduled'], to: 'scheduled', expectedVersion,
   * bumpVersion: true, set: { scheduledAt, scheduledVia: 'manual' } })`.
   * One UPDATE ... WHERE status/version; on a miss the row is re-read to report
   * 404, 409 FORBIDDEN_STATE or 409 VERSION_CONFLICT.
   */
  async transition(
    id: string,
    opts: TransitionOptions,
    db: DbExecutor = this.db,
  ): Promise<PostRow> {
    const conditions = [eq(posts.id, id), inArray(posts.status, opts.from)];
    if (opts.expectedVersion !== undefined) {
      conditions.push(eq(posts.version, opts.expectedVersion));
    }
    const [updated] = await db
      .update(posts)
      .set({
        ...opts.set,
        ...(opts.to ? { status: opts.to } : {}),
        ...(opts.bumpVersion ? { version: sql`${posts.version} + 1` } : {}),
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning();
    if (updated) return updated;

    const [current] = await db
      .select({ status: posts.status, version: posts.version })
      .from(posts)
      .where(eq(posts.id, id));
    if (!current) throw ProblemException.notFound('Post not found.');
    assertState(current.status, opts.from, 'changed');
    throw versionConflict(current.version);
  }

  /**
   * Recomputes the post status from its deliveries ({@link derivePostStatus}) and stores
   * it, with `publishedAt` = the latest delivery publish time when anything was published.
   * For the publish worker, after each delivery finishes. Returns the new status.
   */
  async refreshStatus(id: string, db: DbExecutor = this.db): Promise<PostStatus> {
    const rows = await db
      .select({ status: deliveries.status, publishedAt: deliveries.publishedAt })
      .from(deliveries)
      .where(eq(deliveries.postId, id));
    const status = derivePostStatus(rows);
    const published = rows
      .map((r) => r.publishedAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime());
    await db
      .update(posts)
      .set({
        status,
        ...(status === 'published' || status === 'partially_published'
          ? { publishedAt: published[0] ?? new Date() }
          : {}),
      })
      .where(eq(posts.id, id));
    return status;
  }

  /* ---------------------------------- reads --------------------------------- */

  /** Full post detail, or undefined. One SQL query (drizzle relational query with joins). */
  async getDetail(id: string, db: DbExecutor = this.db): Promise<PostDetail | undefined> {
    const row = await db.query.posts.findFirst({
      where: eq(posts.id, id),
      with: {
        deliveries: {
          orderBy: (d, { asc: up }) => [up(d.createdAt), up(d.id)],
          with: {
            channel: {
              columns: {
                id: true,
                provider: true,
                handle: true,
                displayName: true,
                avatarUrl: true,
                status: true,
              },
            },
            items: {
              orderBy: (i, { asc: up }) => [up(i.position)],
              with: {
                media: {
                  orderBy: (m, { asc: up }) => [up(m.position)],
                  with: {
                    media: { columns: { id: true, mime: true, width: true, height: true } },
                  },
                },
                metrics: {
                  orderBy: (m, { desc: down }) => [down(m.fetchedAt)],
                  limit: 1,
                },
              },
            },
            attempts: {
              orderBy: (a, { desc: down }) => [down(a.startedAt), down(a.attempt)],
            },
          },
        },
      },
    });
    if (!row) return undefined;

    const base = row.deliveries.find((d) => !d.customized)?.items[0];
    return {
      id: row.id,
      status: row.status,
      baseContent: row.baseContent,
      // TODO: base media is not stored on the post itself; when every channel is
      // customized it cannot be recovered. Add `posts.base_media_ids` if that matters.
      baseMediaIds: base ? base.media.map((m) => m.mediaId) : [],
      scheduledAt: iso(row.scheduledAt),
      scheduledVia: row.scheduledVia,
      publishedAt: iso(row.publishedAt),
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deliveries: row.deliveries.map((d) => ({
        id: d.id,
        channelId: d.channelId,
        customized: d.customized,
        status: d.status,
        needsAttention: d.needsAttention,
        lastErrorCode: d.lastErrorCode,
        lastErrorMessage: d.lastErrorMessage,
        publishedAt: iso(d.publishedAt),
        channel: d.channel,
        items: d.items.map((item) => {
          const metrics = item.metrics[0];
          return {
            id: item.id,
            position: item.position,
            text: item.text,
            status: item.status,
            remoteId: item.remoteId,
            remoteUrl: item.remoteUrl,
            publishedAt: iso(item.publishedAt),
            media: item.media.map((m) => ({
              id: m.media.id,
              url: mediaUrl(m.media.id),
              mime: m.media.mime,
              width: m.media.width,
              height: m.media.height,
            })),
            latestMetrics: metrics
              ? {
                  checkpoint: metrics.checkpoint,
                  fetchedAt: metrics.fetchedAt.toISOString(),
                  impressions: metrics.impressions,
                  likes: metrics.likes,
                  reposts: metrics.reposts,
                  replies: metrics.replies,
                  quotes: metrics.quotes,
                  bookmarks: metrics.bookmarks,
                }
              : null,
          };
        }),
        attempts: d.attempts.map((a) => ({
          id: a.id,
          attempt: a.attempt,
          startedAt: a.startedAt.toISOString(),
          finishedAt: iso(a.finishedAt),
          outcome: a.outcome,
          errorCode: a.errorCode,
          errorMessage: a.errorMessage,
        })),
      })),
    };
  }

  async mustGetDetail(id: string, db: DbExecutor = this.db): Promise<PostDetail> {
    const detail = await this.getDetail(id, db);
    if (!detail) throw ProblemException.notFound('Post not found.');
    return detail;
  }

  /**
   * Calendar range: posts whose effective time (`published_at`, else `scheduled_at`) is in
   * [from, to), with a deliveries summary. Always exactly ONE SQL query (posts LEFT JOIN
   * deliveries LEFT JOIN channels), whatever the number of posts.
   * Errors: 422 VALIDATION_FAILED when `to <= from` or the range exceeds 62 days.
   */
  async list(query: ListPostsQuery, db: DbExecutor = this.db): Promise<PostList> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to.getTime() <= from.getTime()) {
      throw ProblemException.unprocessable(VALIDATION_FAILED, '`to` must be after `from`.', [
        { path: 'to', code: 'RANGE_INVALID', message: 'Must be after `from`.' },
      ]);
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw ProblemException.unprocessable(
        VALIDATION_FAILED,
        `The range may not exceed ${MAX_RANGE_DAYS} days.`,
        [
          {
            path: 'to',
            code: 'RANGE_TOO_LARGE',
            message: `At most ${MAX_RANGE_DAYS} days after \`from\`.`,
          },
        ],
      );
    }
    const statuses = query.status
      ? [...new Set(query.status.split(',').map((s) => s.trim() as PostStatus))]
      : undefined;

    // Two index-friendly branches rather than coalesce(), so the scheduled_at index applies.
    // TODO: index posts(published_at) if published history grows large.
    const inRange = or(
      and(isNull(posts.publishedAt), gte(posts.scheduledAt, from), lt(posts.scheduledAt, to)),
      and(gte(posts.publishedAt, from), lt(posts.publishedAt, to)),
    );
    const rows = await db
      .select({
        id: posts.id,
        status: posts.status,
        scheduledAt: posts.scheduledAt,
        scheduledVia: posts.scheduledVia,
        publishedAt: posts.publishedAt,
        version: posts.version,
        // Cut in SQL: code-point safe, and the full text is not sent once per delivery.
        preview: sql<string>`left(${posts.baseContent}, ${sql.raw(String(PREVIEW_CHARS))})`,
        deliveryId: deliveries.id,
        channelId: deliveries.channelId,
        deliveryStatus: deliveries.status,
        needsAttention: deliveries.needsAttention,
        provider: channels.provider,
      })
      .from(posts)
      .leftJoin(deliveries, eq(deliveries.postId, posts.id))
      .leftJoin(channels, eq(channels.id, deliveries.channelId))
      .where(and(inRange, statuses ? inArray(posts.status, statuses) : undefined))
      .orderBy(
        asc(sql`coalesce(${posts.publishedAt}, ${posts.scheduledAt})`),
        asc(posts.id),
        asc(deliveries.createdAt),
        asc(deliveries.id),
      );

    const items: PostSummary[] = [];
    const byId = new Map<string, PostSummary>();
    for (const r of rows) {
      let post = byId.get(r.id);
      if (!post) {
        post = {
          id: r.id,
          status: r.status,
          scheduledAt: iso(r.scheduledAt),
          scheduledVia: r.scheduledVia,
          publishedAt: iso(r.publishedAt),
          version: r.version,
          preview: r.preview,
          deliveries: [],
        };
        byId.set(r.id, post);
        items.push(post);
      }
      if (r.deliveryId && r.channelId && r.deliveryStatus && r.provider) {
        post.deliveries.push({
          id: r.deliveryId,
          channelId: r.channelId,
          provider: r.provider,
          status: r.deliveryStatus,
          needsAttention: r.needsAttention ?? false,
        });
      }
    }
    return { items };
  }

  /**
   * Post, deliveries (with channel status and settings) and items (with media ids) in one
   * query, for the scheduler and the publish worker. Undefined when the post is gone, so
   * a stale job can exit as a no-op.
   */
  async getForScheduling(
    id: string,
    db: DbExecutor = this.db,
  ): Promise<SchedulingSnapshot | undefined> {
    const row = await db.query.posts.findFirst({
      where: eq(posts.id, id),
      columns: {
        id: true,
        status: true,
        version: true,
        baseContent: true,
        scheduledAt: true,
        scheduledVia: true,
        publishedAt: true,
      },
      with: {
        deliveries: {
          orderBy: (d, { asc: up }) => [up(d.createdAt), up(d.id)],
          columns: {
            id: true,
            channelId: true,
            customized: true,
            status: true,
            needsAttention: true,
          },
          with: {
            channel: { columns: { id: true, provider: true, status: true, settings: true } },
            items: {
              orderBy: (i, { asc: up }) => [up(i.position)],
              columns: { id: true, position: true, text: true, status: true, remoteId: true },
              with: {
                media: {
                  orderBy: (m, { asc: up }) => [up(m.position)],
                  columns: { mediaId: true },
                },
              },
            },
          },
        },
      },
    });
    if (!row) return undefined;
    const { deliveries: rowDeliveries, ...post } = row;
    return {
      post,
      deliveries: rowDeliveries.map((d) => ({
        ...d,
        items: d.items.map(({ media: itemMedia, ...item }) => ({
          ...item,
          mediaIds: itemMedia.map((m) => m.mediaId),
        })),
      })),
    };
  }

  /**
   * Re-validates the STORED items against the current provider limits and channel
   * settings (e.g. long posts switched off after saving) before a scheduling action.
   * Returns field errors with paths `channels[i].items[j]...`, i = delivery order.
   */
  async validateForScheduling(
    snapshot: SchedulingSnapshot,
    db: DbExecutor = this.db,
  ): Promise<ProblemFieldError[]> {
    const input: PostInput = {
      baseContent: snapshot.post.baseContent,
      baseMediaIds: [],
      channels: snapshot.deliveries.map((d) => ({
        channelId: d.channelId,
        customized: true,
        items: d.items.map((item) => ({ text: item.text, mediaIds: item.mediaIds })),
      })),
    };
    const errors = channelStateErrors(
      input,
      new Map(snapshot.deliveries.map((d) => [d.channelId, d.channel])),
    );
    const result = validatePostInput(
      input,
      snapshot.deliveries.map((d) => toChannelContext(d.channel)),
      VALIDATION_LIMITS,
      { media: await loadMediaInfo(db, input) },
    );
    return [...errors, ...toProblemFieldErrors(result.errors)];
  }

  /** {@link validateForScheduling} that throws 422 VALIDATION_FAILED on any error. */
  async assertSchedulable(snapshot: SchedulingSnapshot, db: DbExecutor = this.db): Promise<void> {
    const errors = await this.validateForScheduling(snapshot, db);
    if (errors.length > 0) {
      throw ProblemException.unprocessable(
        VALIDATION_FAILED,
        'The post cannot be scheduled as it is.',
        errors,
      );
    }
  }

  /* -------------------------------- internals ------------------------------- */

  /** Loads channels and media, validates the input and derives the items per channel. */
  private async planDeliveries(db: DbExecutor, input: PostInput): Promise<DeliveryPlan[]> {
    const ids = [...new Set(input.channels.map((c) => c.channelId))];
    const rows =
      ids.length === 0
        ? []
        : await db
            .select({
              id: channels.id,
              provider: channels.provider,
              status: channels.status,
              settings: channels.settings,
            })
            .from(channels)
            .where(inArray(channels.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const contexts = rows.map(toChannelContext);

    const errors = channelStateErrors(input, byId);
    const result = validatePostInput(input, contexts, VALIDATION_LIMITS, {
      media: await loadMediaInfo(db, input),
    });
    errors.push(...toProblemFieldErrors(result.errors));
    if (errors.length > 0) {
      throw ProblemException.unprocessable(
        VALIDATION_FAILED,
        'The post did not pass validation.',
        errors,
      );
    }

    return input.channels.map((channelInput) => ({
      channelId: channelInput.channelId,
      customized: channelInput.customized,
      items: deriveItems(
        input,
        channelInput,
        toChannelContext(byId.get(channelInput.channelId)!),
        VALIDATION_LIMITS,
      ),
    }));
  }

  /**
   * Makes the stored deliveries match the plan: drops deliveries of unselected channels,
   * upserts one per selected channel and rebuilds every item and item-media row.
   * A constant number of statements whatever the number of channels and items.
   */
  private async writeDeliveries(db: DbExecutor, postId: string, plan: DeliveryPlan[]) {
    const channelIds = plan.map((p) => p.channelId);
    await db
      .delete(deliveries)
      .where(and(eq(deliveries.postId, postId), notInArray(deliveries.channelId, channelIds)));

    const upserted = await db
      .insert(deliveries)
      .values(plan.map((p) => ({ postId, channelId: p.channelId, customized: p.customized })))
      .onConflictDoUpdate({
        target: [deliveries.postId, deliveries.channelId],
        set: { customized: sql`excluded.customized`, updatedAt: sql`now()` },
      })
      .returning({ id: deliveries.id, channelId: deliveries.channelId });
    const deliveryIdByChannel = new Map(upserted.map((d) => [d.channelId, d.id]));

    // Items are only ever rebuilt while nothing was published (draft/scheduled).
    await db.delete(deliveryItems).where(
      inArray(
        deliveryItems.deliveryId,
        upserted.map((d) => d.id),
      ),
    );

    const itemValues = plan.flatMap((p) =>
      p.items.map((item, position) => ({
        deliveryId: deliveryIdByChannel.get(p.channelId)!,
        position,
        text: item.text,
      })),
    );
    if (itemValues.length === 0) return;
    const insertedItems = await db.insert(deliveryItems).values(itemValues).returning({
      id: deliveryItems.id,
      deliveryId: deliveryItems.deliveryId,
      position: deliveryItems.position,
    });
    const itemId = new Map(insertedItems.map((i) => [`${i.deliveryId}:${i.position}`, i.id]));

    const mediaValues = plan.flatMap((p) => {
      const deliveryId = deliveryIdByChannel.get(p.channelId)!;
      return p.items.flatMap((item, position) =>
        item.mediaIds.map((mediaId, mediaPosition) => ({
          deliveryItemId: itemId.get(`${deliveryId}:${position}`)!,
          mediaId,
          position: mediaPosition,
        })),
      );
    });
    if (mediaValues.length > 0) await db.insert(deliveryItemMedia).values(mediaValues);
  }
}

/* --------------------------------- helpers -------------------------------- */

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function toChannelContext(row: {
  id: string;
  provider: ChannelContext['provider'];
  settings: { longPostsEnabled: boolean } | null;
}): ChannelContext {
  return {
    id: row.id,
    provider: row.provider,
    settings: { longPostsEnabled: row.settings?.longPostsEnabled ?? false },
  };
}

/** Disconnected channels cannot receive posts; unknown ids are reported by validatePostInput. */
function channelStateErrors(
  input: PostInput,
  byId: ReadonlyMap<string, { status: (typeof channels.$inferSelect)['status'] }>,
): ProblemFieldError[] {
  const errors: ProblemFieldError[] = [];
  input.channels.forEach((c, i) => {
    if (byId.get(c.channelId)?.status === 'disconnected') {
      errors.push({
        path: `channels[${i}].channelId`,
        code: 'CHANNEL_DISCONNECTED',
        message: 'This channel is disconnected. Reconnect it or remove it from the post.',
      });
    }
  });
  return errors;
}

/** mime + bytes of every media id the input references, in one query. */
async function loadMediaInfo(db: DbExecutor, input: PostInput): Promise<Map<string, MediaInfo>> {
  const ids = new Set(input.baseMediaIds);
  for (const c of input.channels) {
    for (const item of c.items ?? []) for (const id of item.mediaIds) ids.add(id);
  }
  if (ids.size === 0) return new Map();
  const rows = await db
    .select({ id: media.id, mime: media.mime, bytes: media.bytes })
    .from(media)
    .where(inArray(media.id, [...ids]));
  return new Map(rows.map((r) => [r.id, { mime: r.mime, bytes: r.bytes }]));
}

function forbiddenState(status: PostStatus, action: string): ProblemException {
  return ProblemException.conflict(FORBIDDEN_STATE, `A ${status} post cannot be ${action}.`);
}

function assertState(status: PostStatus, allowed: readonly PostStatus[], action: string): void {
  if (!allowed.includes(status)) throw forbiddenState(status, action);
}

function versionConflict(current: number): ProblemException {
  return ProblemException.conflict(
    VERSION_CONFLICT,
    `The post was modified elsewhere (current version ${current}). Reload it and try again.`,
  );
}
