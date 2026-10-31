import { type Job, type Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deliveries, posts } from '../../src/db/schema';
import { JOB, QUEUE } from '../../src/queues/queue.constants';
import {
  publishDeliveryJobId,
  publishFinalizeJobId,
  publishPostJobId,
} from '../../src/scheduling/scheduling.types';
import {
  type Channel,
  createChannel,
  createDelivery,
  createDeliveryItem,
  createPost,
} from '../factories';
import { createTestApp, type TestApp } from '../helpers/app';
import { type AuthedAgent, loginAs } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { getQueue, obliterateQueues, runJobToCompletion } from '../helpers/jobs';

const HOUR = 3_600_000;
const API = '/api/v1';

/** Polls until `fn` returns a truthy value (or throws on timeout). */
async function waitFor<T>(
  fn: () => Promise<T | undefined | false>,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('scheduling', () => {
  let t: TestApp;
  let owner: AuthedAgent;
  let queue: Queue;
  let x: Channel;
  let linkedin: Channel;

  beforeAll(async () => {
    t = await createTestApp();
    queue = getQueue(t.app, QUEUE.publish);
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await obliterateQueues([queue]);
    await resetDb(t.db);
    owner = await loginAs(t);
    x = await createChannel(t.db, { provider: 'x', handle: 'omero_x' });
    linkedin = await createChannel(t.db, { provider: 'linkedin', handle: 'omero-li' });
  });

  /** A draft for both channels, created through the API. */
  async function createDraft(content = 'Hello from omero') {
    const res = await owner.http
      .post(`${API}/posts`)
      .send({
        baseContent: content,
        baseMediaIds: [],
        channels: [
          { channelId: x.id, customized: false },
          { channelId: linkedin.id, customized: false },
        ],
      })
      .expect(201);
    return res.body as { id: string; version: number; deliveries: Array<{ id: string }> };
  }

  const act = (id: string, action: string, body: object) =>
    owner.http.post(`${API}/posts/${id}/${action}`).send(body);

  const schedule = (id: string, at: Date | string, version: number) =>
    act(id, 'schedule', { at: typeof at === 'string' ? at : at.toISOString(), version });

  const dbPost = async (id: string) =>
    (await t.db.select().from(posts).where(eq(posts.id, id)))[0]!;

  const delayedJobs = async (): Promise<Job[]> =>
    (await queue.getJobs(['delayed'])).filter((job) => job.name === JOB.publishPost);

  const inHours = (hours: number) => new Date(Date.now() + hours * HOUR);

  describe('POST /posts/:id/schedule', () => {
    it('schedules a draft and creates exactly one delayed job with the right delay', async () => {
      const draft = await createDraft();
      const at = inHours(2);
      const before = Date.now();

      const res = await schedule(draft.id, at, draft.version).expect(200);

      expect(res.body).toMatchObject({
        id: draft.id,
        status: 'scheduled',
        scheduledAt: at.toISOString(),
        scheduledVia: 'manual',
        version: draft.version + 1,
      });
      const jobs = await delayedJobs();
      expect(jobs).toHaveLength(1);
      const [job] = jobs;
      expect(job!.id).toBe(publishPostJobId(draft.id, draft.version + 1));
      expect(job!.data).toEqual({ postId: draft.id, version: draft.version + 1 });
      expect(job!.opts.delay).toBeGreaterThan(at.getTime() - before - 5_000);
      expect(job!.opts.delay).toBeLessThanOrEqual(at.getTime() - before);
      expect(await job!.getState()).toBe('delayed');
    });

    it('leaves exactly one job after rescheduling twice', async () => {
      const draft = await createDraft();
      const first = await schedule(draft.id, inHours(1), draft.version).expect(200);
      const second = await schedule(draft.id, inHours(2), first.body.version).expect(200);
      const latestAt = inHours(3);
      const third = await schedule(draft.id, latestAt, second.body.version).expect(200);

      expect(third.body.version).toBe(draft.version + 3);
      const jobs = await delayedJobs();
      expect(jobs.map((job) => job.id)).toEqual([publishPostJobId(draft.id, third.body.version)]);
      expect(jobs[0]!.opts.delay).toBeGreaterThan(2 * HOUR + 59 * 60_000);
      // Older versions are gone, not just shadowed.
      expect(await queue.getJob(publishPostJobId(draft.id, draft.version + 1))).toBeUndefined();
      expect(await queue.getJob(publishPostJobId(draft.id, draft.version + 2))).toBeUndefined();
    });

    it('rejects a time in the past with 422 and changes nothing', async () => {
      const draft = await createDraft();

      const res = await schedule(draft.id, new Date(Date.now() - 5 * 60_000), draft.version).expect(
        422,
      );

      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ path: 'at', code: 'SCHEDULE_IN_PAST' }],
      });
      expect(await delayedJobs()).toHaveLength(0);
      expect(await dbPost(draft.id)).toMatchObject({ status: 'draft', version: draft.version });
    });

    it('tolerates 30 s of clock slack and runs the job right away', async () => {
      const draft = await createDraft();
      const res = await schedule(draft.id, new Date(Date.now() - 10_000), draft.version);
      expect(res.status).toBe(200);
      // Delay is clamped to 0, so a worker picks it up and starts the publish flow.
      await waitFor(async () => (await dbPost(draft.id)).status === 'publishing');
    });

    it('answers 409 on a stale version and on a post that is past scheduling', async () => {
      const draft = await createDraft();
      const stale = await schedule(draft.id, inHours(1), draft.version + 7).expect(409);
      expect(stale.body.code).toBe('VERSION_CONFLICT');

      const published = await createPost(t.db, { status: 'published' });
      const forbidden = await schedule(published.id, inHours(1), published.version).expect(409);
      expect(forbidden.body.code).toBe('FORBIDDEN_STATE');

      await schedule('0190a000-0000-7000-8000-000000000000', inHours(1), 1).expect(404);
      expect(await delayedJobs()).toHaveLength(0);
    });

    it('rolls back with 422 when the stored post no longer passes validation', async () => {
      const post = await createPost(t.db);
      const delivery = await createDelivery(t.db, { postId: post.id, channelId: x.id });
      await createDeliveryItem(t.db, { deliveryId: delivery.id, text: 'a'.repeat(400) });

      const res = await schedule(post.id, inHours(1), post.version).expect(422);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors.length).toBeGreaterThan(0);
      expect(await dbPost(post.id)).toMatchObject({ status: 'draft', version: post.version });
      expect(await delayedJobs()).toHaveLength(0);
    });

    it('requires a session', async () => {
      await t
        .http()
        .post(`${API}/posts/0190a000-0000-7000-8000-000000000000/schedule`)
        .send({ at: inHours(1).toISOString(), version: 1 })
        .expect(401);
    });
  });

  describe('publish-post job', () => {
    it('is a no-op when its version is stale, the post is not scheduled, or it is gone', async () => {
      const draft = await createDraft();
      const scheduled = await schedule(draft.id, inHours(1), draft.version).expect(200);
      const run = async (postId: string, version: number) =>
        (await runJobToCompletion(queue, JOB.publishPost, { postId, version })).result;

      expect(await run(draft.id, draft.version)).toEqual({
        outcome: 'skipped',
        reason: 'stale_version',
      });
      expect(await run('0190a000-0000-7000-8000-000000000000', 1)).toEqual({
        outcome: 'skipped',
        reason: 'post_missing',
      });
      const other = await createDraft('Another draft');
      expect(await run(other.id, other.version)).toEqual({
        outcome: 'skipped',
        reason: 'not_scheduled',
      });

      expect(await dbPost(draft.id)).toMatchObject({
        status: 'scheduled',
        version: scheduled.body.version,
      });
      expect(await dbPost(other.id)).toMatchObject({ status: 'draft' });
      expect(await queue.getJob(publishPostJobId(draft.id, scheduled.body.version))).toBeDefined();
    });

    it('marks the post publishing and starts a flow with one child per pending or failed delivery', async () => {
      const draft = await createDraft();
      const [first, second] = draft.deliveries;
      const third = await createDelivery(t.db, {
        postId: draft.id,
        channelId: (await createChannel(t.db, { provider: 'linkedin', handle: 'second-li' })).id,
        status: 'failed',
      });
      await createDeliveryItem(t.db, { deliveryId: third.id, text: 'Hello from omero' });
      const done = await createDelivery(t.db, {
        postId: draft.id,
        channelId: (await createChannel(t.db, { provider: 'x', handle: 'done_x' })).id,
        status: 'published',
      });
      await createDeliveryItem(t.db, {
        deliveryId: done.id,
        text: 'Hello from omero',
        status: 'published',
      });

      const res = await act(draft.id, 'publish-now', { version: draft.version }).expect(200);
      const version: number = res.body.version;
      expect(res.body).toMatchObject({
        status: 'scheduled',
        scheduledVia: 'now',
        version: draft.version + 1,
      });

      // The delay-0 parent runs at once and flips the post to publishing.
      await waitFor(async () => (await dbPost(draft.id)).status === 'publishing');
      const parent = await waitFor(() => queue.getJob(publishPostJobId(draft.id, version)));
      await waitFor(async () => (await parent.getState()) === 'completed');
      expect(parent.opts.delay).toBe(0);
      expect(parent.returnvalue).toEqual({ outcome: 'started', deliveries: 3 });

      const finalizer = await queue.getJob(publishFinalizeJobId(draft.id, version));
      expect(finalizer).toBeDefined();
      expect(finalizer!.name).toBe(JOB.publishPostFinalize);
      expect(finalizer!.data).toEqual({ postId: draft.id, version });
      expect(await finalizer!.getState()).toBe('waiting-children');

      const deps = await finalizer!.getDependencies();
      const childKeys = [...(deps.unprocessed ?? []), ...Object.keys(deps.processed ?? {})];
      expect(childKeys).toHaveLength(3);

      const expectedIds = [first!.id, second!.id, third.id];
      for (const deliveryId of expectedIds) {
        const child = await queue.getJob(publishDeliveryJobId(deliveryId, version));
        expect(child, `child for ${deliveryId}`).toBeDefined();
        expect(child!.name).toBe(JOB.publishDelivery);
        expect(child!.data).toEqual({ postId: draft.id, deliveryId, version });
        expect(child!.opts).toMatchObject({
          attempts: 3,
          backoff: { type: 'exponential', delay: 120_000 },
          failParentOnFailure: false,
          ignoreDependencyOnFailure: true,
        });
        expect(child!.parentKey).toContain(publishFinalizeJobId(draft.id, version));
      }
      // The already published delivery gets no child.
      expect(await queue.getJob(publishDeliveryJobId(done.id, version))).toBeUndefined();

      // The placeholder handler fails (T024 replaces it); the failure is retried, not fatal.
      const retried = await waitFor(async () => {
        const job = await queue.getJob(publishDeliveryJobId(first!.id, version));
        return job && (await job.getState()) === 'delayed' ? job : undefined;
      });
      expect(retried.failedReason).toBe('not implemented (T024)');
      expect(retried.attemptsMade).toBe(1);
    });

    it('finalizes the post status from its deliveries', async () => {
      const post = await createPost(t.db, { status: 'publishing' });
      await createDelivery(t.db, { postId: post.id, status: 'published', publishedAt: new Date() });
      await createDelivery(t.db, { postId: post.id, status: 'failed' });

      const { result } = await runJobToCompletion(queue, JOB.publishPostFinalize, {
        postId: post.id,
        version: post.version,
      });

      expect(result).toEqual({ outcome: 'finalized', status: 'partially_published' });
      expect(await dbPost(post.id)).toMatchObject({ status: 'partially_published' });
      expect(
        (await t.db.select().from(deliveries).where(eq(deliveries.postId, post.id))).length,
      ).toBe(2);

      // A post that is not publishing is left alone.
      const draft = await createPost(t.db);
      const skipped = await runJobToCompletion(queue, JOB.publishPostFinalize, {
        postId: draft.id,
        version: draft.version,
      });
      expect(skipped.result).toEqual({ outcome: 'skipped', reason: 'not_publishing' });
    });
  });

  describe('POST /posts/:id/queue', () => {
    const enableSlots = async () => {
      // Every weekday at three times, so there is always a slot within a day.
      const slots = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) =>
        ['06:00', '12:00', '18:00'].map((localTime) => ({ weekday, localTime, enabled: true })),
      );
      await owner.http.put(`${API}/queue-slots`).send(slots).expect(200);
    };

    it('assigns the next free slot, then the following one', async () => {
      await enableSlots();
      const preview = await owner.http.get(`${API}/queue-slots/next`).expect(200);
      const a = await createDraft('first');
      const b = await createDraft('second');

      const first = await act(a.id, 'queue', { version: a.version }).expect(200);
      const second = await act(b.id, 'queue', { version: b.version }).expect(200);

      expect(first.body.scheduledAt).toBe(preview.body.scheduledAt);
      expect(first.body.post).toMatchObject({
        id: a.id,
        status: 'scheduled',
        scheduledVia: 'queue',
        scheduledAt: first.body.scheduledAt,
        version: a.version + 1,
      });
      expect(new Date(second.body.scheduledAt).getTime()).toBeGreaterThan(
        new Date(first.body.scheduledAt).getTime(),
      );
      const jobs = await delayedJobs();
      expect(jobs.map((job) => job.id).sort()).toEqual(
        [publishPostJobId(a.id, a.version + 1), publishPostJobId(b.id, b.version + 1)].sort(),
      );
    });

    it('gives concurrent queue calls different slots', async () => {
      await enableSlots();
      const drafts = await Promise.all([1, 2, 3, 4].map((n) => createDraft(`post ${n}`)));

      const results = await Promise.all(
        drafts.map((d) => act(d.id, 'queue', { version: d.version })),
      );

      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      const times = results.map((r) => r.body.scheduledAt as string);
      expect(new Set(times).size).toBe(4);
      const rows = await t.db.select({ at: posts.scheduledAt }).from(posts);
      expect(new Set(rows.map((r) => r.at?.toISOString())).size).toBe(4);
    });

    it('answers 422 NO_FREE_SLOT when there are no slots, leaving the post a draft', async () => {
      const draft = await createDraft();

      const res = await act(draft.id, 'queue', { version: draft.version }).expect(422);

      expect(res.body.code).toBe('NO_FREE_SLOT');
      expect(await dbPost(draft.id)).toMatchObject({ status: 'draft', version: draft.version });
      expect(await delayedJobs()).toHaveLength(0);
    });

    it('reports a stale version before looking for a slot', async () => {
      const draft = await createDraft();
      const res = await act(draft.id, 'queue', { version: draft.version + 3 }).expect(409);
      expect(res.body.code).toBe('VERSION_CONFLICT');
    });
  });

  describe('POST /posts/:id/unschedule', () => {
    it('removes the job and takes the post back to draft', async () => {
      const draft = await createDraft();
      const scheduled = await schedule(draft.id, inHours(1), draft.version).expect(200);
      expect(await delayedJobs()).toHaveLength(1);

      const res = await act(draft.id, 'unschedule', { version: scheduled.body.version }).expect(
        200,
      );

      expect(res.body).toMatchObject({
        status: 'draft',
        scheduledAt: null,
        scheduledVia: null,
        version: scheduled.body.version + 1,
      });
      expect(await delayedJobs()).toHaveLength(0);
    });

    it('answers 409 for a draft and for a stale version', async () => {
      const draft = await createDraft();
      const forbidden = await act(draft.id, 'unschedule', { version: draft.version }).expect(409);
      expect(forbidden.body.code).toBe('FORBIDDEN_STATE');

      const scheduled = await schedule(draft.id, inHours(1), draft.version).expect(200);
      const stale = await act(draft.id, 'unschedule', { version: draft.version }).expect(409);
      expect(stale.body.code).toBe('VERSION_CONFLICT');
      expect(await delayedJobs()).toHaveLength(1);
      expect((await dbPost(draft.id)).version).toBe(scheduled.body.version);
    });
  });

  describe('editing and deleting a scheduled post', () => {
    it('re-enqueues the job with the new version and the same scheduled time', async () => {
      const draft = await createDraft();
      const at = inHours(5);
      const scheduled = await schedule(draft.id, at, draft.version).expect(200);

      const edited = await owner.http
        .put(`${API}/posts/${draft.id}`)
        .send({
          baseContent: 'Edited text',
          baseMediaIds: [],
          channels: [{ channelId: x.id, customized: false }],
          version: scheduled.body.version,
        })
        .expect(200);

      expect(edited.body).toMatchObject({
        status: 'scheduled',
        version: scheduled.body.version + 1,
        scheduledAt: at.toISOString(),
      });
      const jobs = await delayedJobs();
      expect(jobs.map((job) => job.id)).toEqual([publishPostJobId(draft.id, edited.body.version)]);
      expect(jobs[0]!.data).toEqual({ postId: draft.id, version: edited.body.version });
      // Same instant: enqueue time plus delay lands on scheduledAt.
      expect(Math.abs(jobs[0]!.timestamp + jobs[0]!.opts.delay! - at.getTime())).toBeLessThan(
        2_000,
      );
    });

    it('does not enqueue anything when a draft is edited', async () => {
      const draft = await createDraft();
      await owner.http
        .put(`${API}/posts/${draft.id}`)
        .send({
          baseContent: 'Edited draft',
          baseMediaIds: [],
          channels: [{ channelId: x.id, customized: false }],
          version: draft.version,
        })
        .expect(200);
      expect(await delayedJobs()).toHaveLength(0);
    });

    it('removes the job when the post is deleted', async () => {
      const draft = await createDraft();
      const scheduled = await schedule(draft.id, inHours(1), draft.version).expect(200);
      expect(await delayedJobs()).toHaveLength(1);

      await owner.http.delete(`${API}/posts/${draft.id}`).expect(204);

      expect(await delayedJobs()).toHaveLength(0);
      expect(
        await queue.getJob(publishPostJobId(draft.id, scheduled.body.version)),
      ).toBeUndefined();
    });
  });
});
