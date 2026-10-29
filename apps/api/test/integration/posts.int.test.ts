import { eq } from 'drizzle-orm';
import { type Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PG_POOL } from '../../src/db/db.module';
import {
  deliveries,
  deliveryAttempts,
  deliveryItemMedia,
  deliveryItems,
  media,
  postMetrics,
  posts,
} from '../../src/db/schema';
import { PostsService } from '../../src/posts/posts.service';
import {
  type Channel,
  createChannel,
  createDelivery,
  createDeliveryItem,
  createMedia,
  createPost,
} from '../factories';
import { createTestApp, type TestApp } from '../helpers/app';
import { resetDb } from '../helpers/db';

const DAY = 86_400_000;

describe('posts', () => {
  let t: TestApp;
  let x: Channel;
  let linkedin: Channel;

  beforeAll(async () => {
    t = await createTestApp({ env: { WORKERS_ENABLED: 'false' } });
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await resetDb(t.db);
    x = await createChannel(t.db, { provider: 'x', handle: 'omero_x' });
    linkedin = await createChannel(t.db, { provider: 'linkedin', handle: 'omero-li' });
  });

  const createViaApi = (body: object) => t.http().post('/api/v1/posts').send(body);

  /** X customized into a 3-item thread, LinkedIn from the base content. */
  async function threadPost() {
    const [m1, m2] = [await createMedia(t.db), await createMedia(t.db, { mime: 'image/png' })];
    const res = await createViaApi({
      baseContent: 'Launching omero today, a self-hosted publisher.',
      baseMediaIds: [m1.id],
      channels: [
        {
          channelId: x.id,
          customized: true,
          items: [
            { text: 'Launching omero today 1/3', mediaIds: [m1.id, m2.id] },
            { text: 'It is self-hosted 2/3', mediaIds: [] },
            { text: 'And open source 3/3', mediaIds: [] },
          ],
        },
        { channelId: linkedin.id, customized: false },
      ],
    }).expect(201);
    return { res, m1, m2 };
  }

  describe('POST /posts', () => {
    it('creates a draft with an X thread override and LinkedIn from the base content', async () => {
      const { res, m1, m2 } = await threadPost();
      const post = res.body;
      expect(post).toMatchObject({
        status: 'draft',
        version: 1,
        baseContent: 'Launching omero today, a self-hosted publisher.',
        baseMediaIds: [m1.id],
        scheduledAt: null,
      });
      expect(post.deliveries).toHaveLength(2);

      const [xd, lid] = post.deliveries;
      expect(xd).toMatchObject({
        channelId: x.id,
        customized: true,
        status: 'pending',
        channel: { id: x.id, provider: 'x', handle: 'omero_x', status: 'connected' },
        attempts: [],
      });
      expect(xd.items.map((i: { text: string }) => i.text)).toEqual([
        'Launching omero today 1/3',
        'It is self-hosted 2/3',
        'And open source 3/3',
      ]);
      expect(xd.items.map((i: { position: number }) => i.position)).toEqual([0, 1, 2]);
      expect(xd.items[0].media).toEqual([
        { id: m1.id, url: `/api/v1/media/${m1.id}`, mime: 'image/jpeg', width: 800, height: 600 },
        { id: m2.id, url: `/api/v1/media/${m2.id}`, mime: 'image/png', width: 800, height: 600 },
      ]);
      expect(xd.items[0].latestMetrics).toBeNull();

      expect(lid).toMatchObject({
        channelId: linkedin.id,
        customized: false,
        channel: { provider: 'linkedin' },
      });
      expect(lid.items).toHaveLength(1);
      expect(lid.items[0]).toMatchObject({
        text: 'Launching omero today, a self-hosted publisher.',
        media: [{ id: m1.id }],
      });

      expect(await t.db.select().from(deliveryItems)).toHaveLength(4);
      expect(await t.db.select().from(deliveryItemMedia)).toHaveLength(3);
    });

    it('splits long base content into an X thread when X is not customized', async () => {
      const sentence = 'This sentence is part of a long post about self-hosting. ';
      const res = await createViaApi({
        baseContent: sentence.repeat(10).trim(),
        channels: [{ channelId: x.id, customized: false }],
      }).expect(201);
      const items = res.body.deliveries[0].items as Array<{ text: string }>;
      expect(items.length).toBeGreaterThan(1);
      for (const item of items) expect(item.text.length).toBeLessThanOrEqual(280);
    });

    it('accepts WebP for LinkedIn (converted to JPEG at publish time)', async () => {
      const webp = await createMedia(t.db, { mime: 'image/webp' });
      await createViaApi({
        baseContent: 'With a webp',
        baseMediaIds: [webp.id],
        channels: [{ channelId: linkedin.id, customized: false }],
      }).expect(201);
    });

    it('maps provider validation errors to field paths with 422', async () => {
      const big = await createMedia(t.db, { bytes: 6 * 1024 * 1024 });
      const res = await createViaApi({
        baseContent: 'Base',
        channels: [
          {
            channelId: x.id,
            customized: true,
            items: [
              { text: 'fine', mediaIds: [] },
              { text: 'x'.repeat(281), mediaIds: [big.id] },
            ],
          },
          { channelId: '01900000-0000-7000-8000-000000000001', customized: false },
        ],
      })
        .expect(422)
        .expect('content-type', /application\/problem\+json/);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'channels[0].items[1].text', code: 'TEXT_TOO_LONG' }),
          expect.objectContaining({
            path: 'channels[0].items[1].mediaIds[0]',
            code: 'MEDIA_TOO_LARGE',
          }),
          expect.objectContaining({ path: 'channels[1].channelId', code: 'UNKNOWN_CHANNEL' }),
        ]),
      );
      expect(await t.db.select().from(posts)).toHaveLength(0);
    });

    it('rejects disconnected channels and unknown media with 422', async () => {
      const gone = await createChannel(t.db, { status: 'disconnected' });
      const res = await createViaApi({
        baseContent: 'Hello',
        baseMediaIds: ['01900000-0000-7000-8000-0000000000aa'],
        channels: [
          { channelId: x.id, customized: false },
          { channelId: gone.id, customized: false },
        ],
      }).expect(422);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'channels[1].channelId', code: 'CHANNEL_DISCONNECTED' }),
          expect.objectContaining({
            path: 'channels[0].items[0].mediaIds[0]',
            code: 'MEDIA_NOT_FOUND',
          }),
        ]),
      );
    });

    it('rejects malformed bodies with 400', async () => {
      const res = await createViaApi({ baseContent: 1, channels: 'nope' }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('GET /posts/:id', () => {
    it('includes attempts (latest first) and the latest metrics per item', async () => {
      const { res } = await threadPost();
      const xDelivery = res.body.deliveries[0];
      const firstItem = xDelivery.items[0];

      await t.db.insert(deliveryAttempts).values([
        {
          deliveryId: xDelivery.id,
          attempt: 1,
          startedAt: new Date(Date.now() - 60_000),
          outcome: 'retryable_error',
          errorCode: 'HTTP_503',
        },
        { deliveryId: xDelivery.id, attempt: 2, startedAt: new Date(), outcome: 'success' },
      ]);
      await t.db.insert(postMetrics).values([
        {
          deliveryItemId: firstItem.id,
          checkpoint: '1h',
          fetchedAt: new Date(Date.now() - DAY),
          likes: 1,
        },
        { deliveryItemId: firstItem.id, checkpoint: '24h', fetchedAt: new Date(), likes: 9 },
      ]);

      const detail = await t.http().get(`/api/v1/posts/${res.body.id}`).expect(200);
      const d = detail.body.deliveries[0];
      expect(d.attempts.map((a: { attempt: number }) => a.attempt)).toEqual([2, 1]);
      expect(d.items[0].latestMetrics).toMatchObject({ checkpoint: '24h', likes: 9 });
      expect(d.items[1].latestMetrics).toBeNull();
    });

    it('returns 404 for an unknown post', async () => {
      await t.http().get('/api/v1/posts/01900000-0000-7000-8000-000000000002').expect(404);
    });
  });

  describe('PUT /posts/:id', () => {
    it('updates at the current version and increments it', async () => {
      const { res } = await threadPost();
      const updated = await t
        .http()
        .put(`/api/v1/posts/${res.body.id}`)
        .send({
          version: 1,
          baseContent: 'Edited base',
          channels: [
            { channelId: x.id, customized: false },
            { channelId: linkedin.id, customized: false },
          ],
        })
        .expect(200);
      expect(updated.body.version).toBe(2);
      expect(updated.body.deliveries[0]).toMatchObject({ customized: false });
      expect(updated.body.deliveries[0].items.map((i: { text: string }) => i.text)).toEqual([
        'Edited base',
      ]);
      // Delivery ids survive an edit (upsert), items are rebuilt.
      expect(updated.body.deliveries[0].id).toBe(res.body.deliveries[0].id);
      expect(await t.db.select().from(deliveryItems)).toHaveLength(2);
      expect(await t.db.select().from(deliveryItemMedia)).toHaveLength(0);
    });

    it('answers 409 VERSION_CONFLICT for a stale version', async () => {
      const { res } = await threadPost();
      const body = {
        baseContent: 'Edit',
        channels: [{ channelId: x.id, customized: false }],
      };
      await t
        .http()
        .put(`/api/v1/posts/${res.body.id}`)
        .send({ ...body, version: 1 })
        .expect(200);
      const conflict = await t
        .http()
        .put(`/api/v1/posts/${res.body.id}`)
        .send({ ...body, version: 1 })
        .expect(409);
      expect(conflict.body.code).toBe('VERSION_CONFLICT');
    });

    it('keeps a scheduled post scheduled', async () => {
      const at = new Date(Date.now() + DAY);
      const post = await createPost(t.db, { status: 'scheduled', scheduledAt: at, version: 4 });
      const res = await t
        .http()
        .put(`/api/v1/posts/${post.id}`)
        .send({
          version: 4,
          baseContent: 'Rescheduled text',
          channels: [{ channelId: x.id, customized: false }],
        })
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'scheduled',
        version: 5,
        scheduledAt: at.toISOString(),
      });
    });

    it('answers 409 FORBIDDEN_STATE when editing a published post', async () => {
      const post = await createPost(t.db, { status: 'published', publishedAt: new Date() });
      const res = await t
        .http()
        .put(`/api/v1/posts/${post.id}`)
        .send({
          version: 1,
          baseContent: 'Too late',
          channels: [{ channelId: x.id, customized: false }],
        })
        .expect(409);
      expect(res.body.code).toBe('FORBIDDEN_STATE');
    });

    it('removing a channel deletes its delivery', async () => {
      const { res } = await threadPost();
      const updated = await t
        .http()
        .put(`/api/v1/posts/${res.body.id}`)
        .send({
          version: 1,
          baseContent: 'Only LinkedIn now',
          channels: [{ channelId: linkedin.id, customized: false }],
        })
        .expect(200);
      expect(updated.body.deliveries).toHaveLength(1);
      expect(updated.body.deliveries[0].channelId).toBe(linkedin.id);
      const rows = await t.db.select().from(deliveries).where(eq(deliveries.postId, res.body.id));
      expect(rows.map((r) => r.channelId)).toEqual([linkedin.id]);
      // The X thread items went with the delivery.
      expect(await t.db.select().from(deliveryItems)).toHaveLength(1);
    });
  });

  describe('DELETE /posts/:id', () => {
    it('deletes draft, scheduled, failed and missed posts with their rows, keeping media', async () => {
      const { res, m1 } = await threadPost();
      await t.http().delete(`/api/v1/posts/${res.body.id}`).expect(204);
      expect(await t.db.select().from(posts)).toHaveLength(0);
      expect(await t.db.select().from(deliveries)).toHaveLength(0);
      expect(await t.db.select().from(deliveryItems)).toHaveLength(0);
      expect(await t.db.select().from(media).where(eq(media.id, m1.id))).toHaveLength(1);

      for (const status of ['scheduled', 'failed', 'missed'] as const) {
        const post = await createPost(t.db, { status });
        await t.http().delete(`/api/v1/posts/${post.id}`).expect(204);
      }
    });

    it('refuses publishing, published and partially published posts with 409', async () => {
      for (const status of ['publishing', 'published', 'partially_published'] as const) {
        const post = await createPost(t.db, { status });
        const res = await t.http().delete(`/api/v1/posts/${post.id}`).expect(409);
        expect(res.body.code).toBe('FORBIDDEN_STATE');
      }
      expect(await t.db.select().from(posts)).toHaveLength(3);
    });

    it('returns 404 for an unknown post', async () => {
      await t.http().delete('/api/v1/posts/01900000-0000-7000-8000-000000000003').expect(404);
    });
  });

  describe('GET /posts (calendar range)', () => {
    const from = new Date('2026-11-01T00:00:00.000Z');
    const to = new Date('2026-12-01T00:00:00.000Z');
    const range = `from=${from.toISOString()}&to=${to.toISOString()}`;

    async function seedPosts(count: number, startDay = 0) {
      for (let i = 0; i < count; i++) {
        const post = await createPost(t.db, {
          status: 'scheduled',
          scheduledAt: new Date(from.getTime() + ((startDay + i) % 29) * DAY + 3_600_000),
          baseContent: `Post ${startDay + i} ${'lorem ipsum '.repeat(20)}`,
        });
        await createDelivery(t.db, { postId: post.id, channelId: x.id });
        await createDelivery(t.db, {
          postId: post.id,
          channelId: linkedin.id,
          needsAttention: true,
        });
      }
    }

    it('returns posts in range with a deliveries summary and a preview', async () => {
      await seedPosts(2);
      // Published inside the range although scheduled before it: included.
      const published = await createPost(t.db, {
        status: 'published',
        scheduledAt: new Date(from.getTime() - 5 * DAY),
        publishedAt: new Date(from.getTime() + 2 * DAY),
      });
      await createDeliveryItem(t.db, {
        deliveryId: (
          await createDelivery(t.db, { postId: published.id, channelId: x.id, status: 'published' })
        ).id,
      });
      // Outside the range, a draft without time, and published outside the range: excluded.
      await createPost(t.db, { status: 'scheduled', scheduledAt: new Date(to.getTime() + DAY) });
      await createPost(t.db, { status: 'draft' });
      await createPost(t.db, {
        status: 'published',
        scheduledAt: new Date(from.getTime() + DAY),
        publishedAt: new Date(to.getTime() + DAY),
      });

      const res = await t.http().get(`/api/v1/posts?${range}`).expect(200);
      const items = res.body.items as Array<{
        id: string;
        preview: string;
        deliveries: Array<{ provider: string; needsAttention: boolean; status: string }>;
      }>;
      expect(items).toHaveLength(3);
      expect(items.map((p) => p.id)).toContain(published.id);
      const first = items[0]!;
      expect(first.preview).toHaveLength(140);
      expect(first.deliveries).toEqual([
        expect.objectContaining({ provider: 'x', status: 'pending', needsAttention: false }),
        expect.objectContaining({ provider: 'linkedin', status: 'pending', needsAttention: true }),
      ]);

      const onlyPublished = await t
        .http()
        .get(`/api/v1/posts?${range}&status=published`)
        .expect(200);
      expect(onlyPublished.body.items.map((p: { id: string }) => p.id)).toEqual([published.id]);
    });

    it('runs a constant number of SQL queries whatever the number of posts', async () => {
      const pool = t.app.get<Pool>(PG_POOL);
      const countQueries = async () => {
        const spy = vi.spyOn(pool, 'query');
        const res = await t.http().get(`/api/v1/posts?${range}`).expect(200);
        const calls = spy.mock.calls.length;
        spy.mockRestore();
        return { calls, posts: res.body.items.length as number };
      };

      await seedPosts(3);
      const small = await countQueries();
      await seedPosts(25, 3);
      const large = await countQueries();

      expect(small.posts).toBe(3);
      expect(large.posts).toBe(28);
      expect(large.calls).toBe(small.calls);
      // At least the range query itself must be observed, so the spy cannot pass vacuously.
      expect(small.calls).toBeGreaterThanOrEqual(1);
      expect(small.calls).toBeLessThanOrEqual(2);
    });

    it('rejects ranges longer than 62 days or inverted with 422', async () => {
      const tooLong = await t.http().get(`/api/v1/posts?from=2026-01-01&to=2026-03-15`).expect(422);
      expect(tooLong.body.errors[0]).toMatchObject({ path: 'to', code: 'RANGE_TOO_LARGE' });
      await t.http().get(`/api/v1/posts?from=2026-03-01&to=2026-02-01`).expect(422);
    });

    it('requires from and to (400)', async () => {
      await t.http().get('/api/v1/posts').expect(400);
      await t.http().get(`/api/v1/posts?${range}&status=bogus`).expect(400);
    });
  });

  describe('scheduling helpers', () => {
    it('transition() bumps the version and reports conflicts; getForScheduling() snapshots', async () => {
      const service = t.app.get(PostsService);
      const { res } = await threadPost();
      const id = res.body.id as string;
      const at = new Date(Date.now() + DAY);

      const scheduled = await service.transition(id, {
        from: ['draft', 'scheduled'],
        to: 'scheduled',
        expectedVersion: 1,
        bumpVersion: true,
        set: { scheduledAt: at, scheduledVia: 'manual' },
      });
      expect(scheduled).toMatchObject({ status: 'scheduled', version: 2, scheduledVia: 'manual' });

      await expect(
        service.transition(id, { from: ['draft', 'scheduled'], expectedVersion: 1 }),
      ).rejects.toMatchObject({ problem: { code: 'VERSION_CONFLICT' } });
      await expect(
        service.transition(id, { from: ['draft'], to: 'scheduled' }),
      ).rejects.toMatchObject({
        problem: { code: 'FORBIDDEN_STATE' },
      });

      const snapshot = await service.getForScheduling(id);
      expect(snapshot?.post).toMatchObject({ id, status: 'scheduled', version: 2 });
      expect(snapshot?.deliveries[0]?.channel).toMatchObject({
        provider: 'x',
        status: 'connected',
      });
      expect(snapshot?.deliveries[0]?.items.map((i) => i.position)).toEqual([0, 1, 2]);
      expect(snapshot?.deliveries[0]?.items[0]?.mediaIds).toHaveLength(2);
      expect(await service.validateForScheduling(snapshot!)).toEqual([]);
      expect(
        await service.getForScheduling('01900000-0000-7000-8000-000000000004'),
      ).toBeUndefined();
    });

    it('refreshStatus() derives the post status from its deliveries', async () => {
      const service = t.app.get(PostsService);
      const post = await createPost(t.db, { status: 'publishing' });
      const publishedAt = new Date('2026-11-02T10:00:00.000Z');
      await createDelivery(t.db, {
        postId: post.id,
        channelId: x.id,
        status: 'published',
        publishedAt,
      });
      await createDelivery(t.db, { postId: post.id, channelId: linkedin.id, status: 'failed' });

      expect(await service.refreshStatus(post.id)).toBe('partially_published');
      const [row] = await t.db.select().from(posts).where(eq(posts.id, post.id));
      expect(row).toMatchObject({ status: 'partially_published', publishedAt });
    });
  });
});
