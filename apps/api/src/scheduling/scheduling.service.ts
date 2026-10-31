import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { type SchedulePostInput } from '@omero/shared';
import { type Queue } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import { ProblemException } from '../common/errors/problem.exception';
import { type Database, DRIZZLE } from '../db/db.module';
import { type PostStatus, posts, type ScheduledVia } from '../db/schema';
import {
  type PostDeletedEvent,
  PostLifecycle,
  type PostLifecycleListener,
  type PostUpdatedEvent,
} from '../posts/post-lifecycle';
import { type PostDetail } from '../posts/posts.dto';
import {
  assertState,
  type DbExecutor,
  PostsService,
  versionConflict,
} from '../posts/posts.service';
import { JOB, QUEUE } from '../queues/queue.constants';
import { QueueSlotsService } from '../settings/queue-slots.service';
import {
  PUBLISH_JOB_RETENTION,
  PUBLISH_POST_ATTEMPTS,
  PUBLISH_POST_BACKOFF,
  type PublishPostJobData,
  publishPostJobId,
} from './scheduling.types';

/** Tolerated client clock skew when `at` is "now" (the composer's "in a minute" picks). */
export const PAST_SLACK_MS = 30_000;

/** Postgres advisory lock serializing slot assignment, so two queue calls never share a slot. */
const QUEUE_ASSIGN_LOCK = sql`select pg_advisory_xact_lock(hashtext('omero:queue-assign'))`;

/** Statuses from which a post can be (re)scheduled. */
const SCHEDULABLE: readonly PostStatus[] = ['draft', 'scheduled'];

export interface QueuedPost {
  scheduledAt: string;
  post: PostDetail;
}

/** The transaction object `Database#transaction` hands to its callback. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

interface ScheduleTarget {
  at: Date;
  via: ScheduledVia;
}

export interface EnqueuePublishInput {
  postId: string;
  /** Version the job is created for (the post's current version). */
  version: number;
  scheduledAt: Date;
  /** Version whose delayed job is replaced; omit when there cannot be one. */
  previousVersion?: number;
}

/**
 * Schedule, queue, publish-now and unschedule, plus the delayed `publish-post` job that
 * goes with them. Postgres decides (conditional UPDATE on status and version); BullMQ only
 * executes, and a job whose version no longer matches does nothing when it runs.
 *
 * Also the posts module's lifecycle listener: edits re-enqueue, deletions remove the job.
 */
@Injectable()
export class SchedulingService implements OnModuleInit, PostLifecycleListener {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly posts: PostsService,
    private readonly slots: QueueSlotsService,
    private readonly lifecycle: PostLifecycle,
    @InjectQueue(QUEUE.publish) private readonly publishQueue: Queue,
  ) {}

  onModuleInit(): void {
    this.lifecycle.register(this);
  }

  /* ----------------------------- HTTP-facing actions ---------------------------- */

  /**
   * `POST /posts/:id/schedule`: from `draft` or `scheduled` (reschedule), at a future time.
   * Errors: 422 (`at` in the past, or the post no longer passes validation), 404,
   * 409 FORBIDDEN_STATE, 409 VERSION_CONFLICT.
   */
  async schedule(id: string, { at, version }: SchedulePostInput): Promise<PostDetail> {
    const when = new Date(at);
    if (when.getTime() < Date.now() - PAST_SLACK_MS) {
      throw ProblemException.unprocessable('VALIDATION_FAILED', 'The time is in the past.', [
        { path: 'at', code: 'SCHEDULE_IN_PAST', message: 'Choose a time in the future.' },
      ]);
    }
    return this.scheduleAt(id, version, () => Promise.resolve({ at: when, via: 'manual' }));
  }

  /**
   * `POST /posts/:id/queue`: the earliest free queue slot. Slot search and assignment run
   * in one transaction behind an advisory lock, so concurrent calls get different slots.
   * Errors as {@link schedule}, plus 422 NO_FREE_SLOT. A post already in the queue skips
   * its own slot (it counts as taken) and moves to the next one.
   */
  async queue(id: string, version: number): Promise<QueuedPost> {
    const post = await this.scheduleAt(
      id,
      version,
      async (tx) => {
        const at = await this.slots.findNextFreeSlot({ db: tx });
        if (!at) {
          throw ProblemException.unprocessable(
            'NO_FREE_SLOT',
            'There is no free queue slot in the next 30 days. Schedule it manually.',
          );
        }
        return { at, via: 'queue' };
      },
      { serializeSlots: true },
    );
    return { scheduledAt: post.scheduledAt!, post };
  }

  /** `POST /posts/:id/publish-now`: scheduled at the current instant, job delay 0. */
  publishNow(id: string, version: number): Promise<PostDetail> {
    return this.scheduleAt(id, version, () => Promise.resolve({ at: new Date(), via: 'now' }));
  }

  /** `POST /posts/:id/unschedule`: `scheduled` back to `draft`; the delayed job is removed. */
  async unschedule(id: string, version: number): Promise<PostDetail> {
    await this.posts.transition(id, {
      from: ['scheduled'],
      to: 'draft',
      expectedVersion: version,
      bumpVersion: true,
      set: { scheduledAt: null, scheduledVia: null },
    });
    await this.removePublishJob(id, version);
    return this.posts.mustGetDetail(id);
  }

  /* ------------------------------ posts module hooks ----------------------------- */

  /**
   * After a content edit: the version changed, so a scheduled post gets a new job (same
   * `scheduledAt`, new version) and the previous one is removed. Drafts have no job.
   */
  async onPostUpdated({ postId }: PostUpdatedEvent): Promise<void> {
    const snapshot = await this.posts.getForScheduling(postId);
    if (!snapshot) return;
    const { status, version, scheduledAt } = snapshot.post;
    if (status !== 'scheduled' || !scheduledAt) return;
    await this.enqueuePublish({
      postId,
      version,
      scheduledAt,
      previousVersion: version - 1,
    });
  }

  /** After a deletion: drop the delayed job (it would be a no-op anyway). */
  async onPostDeleted({ post }: PostDeletedEvent): Promise<void> {
    if (post.status === 'scheduled') await this.removePublishJob(post.id, post.version);
  }

  /* --------------------------------- queue jobs --------------------------------- */

  /**
   * Replaces the delayed `publish-post` job: removes the one of `previousVersion`, then adds
   * `post_{id}_v{version}` delayed until `scheduledAt` (0 when that is now or past).
   * Leftover jobs of older versions are harmless: they find a version mismatch and exit.
   */
  async enqueuePublish({
    postId,
    version,
    scheduledAt,
    previousVersion,
  }: EnqueuePublishInput): Promise<void> {
    if (previousVersion !== undefined) await this.removePublishJob(postId, previousVersion);
    const data: PublishPostJobData = { postId, version };
    await this.publishQueue.add(JOB.publishPost, data, {
      jobId: publishPostJobId(postId, version),
      delay: Math.max(0, scheduledAt.getTime() - Date.now()),
      attempts: PUBLISH_POST_ATTEMPTS,
      backoff: PUBLISH_POST_BACKOFF,
      ...PUBLISH_JOB_RETENTION,
    });
  }

  /** Removes the delayed job of a post version, if it is still there and not running. */
  async removePublishJob(postId: string, version: number): Promise<void> {
    try {
      await this.publishQueue.remove(publishPostJobId(postId, version));
    } catch (err) {
      // A running job cannot be removed; it re-reads the post and exits on its own.
      this.logger.warn({ postId, version, err }, 'Could not remove publish job');
    }
  }

  /* -------------------------------- internals ------------------------------- */

  /**
   * Shared by schedule, queue and publish-now. One transaction: lock the post row (so
   * state and version errors win), resolve the time, apply the conditional transition
   * (`draft|scheduled` -> `scheduled`, version + 1) and re-validate the stored post.
   * Only after the commit is the job enqueued.
   */
  private async scheduleAt(
    id: string,
    version: number,
    resolve: (tx: Tx) => Promise<ScheduleTarget>,
    { serializeSlots = false }: { serializeSlots?: boolean } = {},
  ): Promise<PostDetail> {
    const row = await this.db.transaction(async (tx) => {
      if (serializeSlots) await tx.execute(QUEUE_ASSIGN_LOCK);
      await this.lockPost(tx, id, version);
      const { at, via } = await resolve(tx);
      const updated = await this.posts.transition(
        id,
        {
          from: SCHEDULABLE,
          to: 'scheduled',
          expectedVersion: version,
          bumpVersion: true,
          set: { scheduledAt: at, scheduledVia: via },
        },
        tx,
      );
      const snapshot = await this.posts.getForScheduling(id, tx);
      // A validation failure rolls the transition back.
      await this.posts.assertSchedulable(snapshot!, tx);
      return updated;
    });
    // Read before enqueueing: a delay-0 job can start publishing the moment it is added.
    const detail = await this.posts.mustGetDetail(id);
    await this.enqueuePublish({
      postId: id,
      version: row.version,
      scheduledAt: row.scheduledAt!,
      previousVersion: version,
    });
    return detail;
  }

  /** Locks the row and reports 404 / FORBIDDEN_STATE / VERSION_CONFLICT before anything else. */
  private async lockPost(tx: DbExecutor, id: string, version: number): Promise<void> {
    const [current] = await tx
      .select({ status: posts.status, version: posts.version })
      .from(posts)
      .where(eq(posts.id, id))
      .for('update');
    if (!current) throw ProblemException.notFound('Post not found.');
    assertState(current.status, SCHEDULABLE, 'scheduled');
    if (current.version !== version) throw versionConflict(current.version);
  }
}
