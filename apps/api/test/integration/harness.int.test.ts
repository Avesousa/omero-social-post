import { eq } from 'drizzle-orm';
import { http, HttpResponse } from 'msw';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deliveryItems, posts } from '../../src/db/schema';
import { JOB, QUEUE } from '../../src/queues/queue.constants';
import { createDeliveryItem, createPost } from '../factories';
import { createTestApp, type TestApp } from '../helpers/app';
import { resetDb } from '../helpers/db';
import { getQueue, runJobToCompletion } from '../helpers/jobs';
import { X_API_BASE } from '../msw/handlers/x';
import { server } from '../msw/server';
import { testCipher } from '../setup/test-env';

// Reference integration test: copy this shape for new suites.
describe('test harness', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await resetDb(t.db);
  });

  it('inserts a post via factories and runs a no-op job end to end', async () => {
    const post = await createPost(t.db, { baseContent: 'Hello from the harness' });
    const item = await createDeliveryItem(t.db);

    const { job, result } = await runJobToCompletion(getQueue(t.app, QUEUE.maintenance), JOB.noop, {
      postId: post.id,
    });

    expect(result).toEqual({ ok: true, data: { postId: post.id } });
    expect(await job.getState()).toBe('completed');

    const [stored] = await t.db.select().from(posts).where(eq(posts.id, post.id));
    expect(stored).toMatchObject({
      baseContent: 'Hello from the harness',
      status: 'draft',
      version: 1,
    });
    // UUIDv7: version nibble is 7.
    expect(stored!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    const [storedItem] = await t.db
      .select()
      .from(deliveryItems)
      .where(eq(deliveryItems.id, item.id));
    expect(storedItem?.position).toBe(0);
  });

  it('surfaces job failures as rejections', async () => {
    await expect(
      runJobToCompletion(getQueue(t.app, QUEUE.maintenance), 'does-not-exist', {}),
    ).rejects.toThrow(/Unknown job "does-not-exist"/);
  });

  it('resetDb() empties every table', async () => {
    await createDeliveryItem(t.db);
    await resetDb(t.db);
    expect(await t.db.select().from(posts)).toHaveLength(0);
  });

  it('factories store tokens encrypted with the test key', async () => {
    const item = await createDeliveryItem(t.db);
    const delivery = await t.db.query.deliveries.findFirst({
      where: (d, { eq: equals }) => equals(d.id, item.deliveryId),
      with: { channel: true },
    });
    const enc = delivery!.channel.accessTokenEnc!;
    expect(enc.startsWith('v1:')).toBe(true);
    expect(testCipher().decrypt(enc)).toMatch(/^access-token-\d+$/);
  });

  it('serves the app over HTTP', async () => {
    const res = await t.http().get('/api/v1/health').expect(200);
    expect(res.body.checks).toMatchObject({ db: { status: 'ok' }, redis: { status: 'ok' } });
  });

  describe('msw', () => {
    it('fails requests to provider hosts that have no handler', async () => {
      await expect(fetch(`${X_API_BASE}/2/users/me`)).rejects.toThrow();
      await expect(fetch('https://api.linkedin.com/v2/userinfo')).rejects.toThrow();
    });

    it('answers with per-test handlers registered through server.use', async () => {
      server.use(
        http.get(`${X_API_BASE}/2/users/me`, () =>
          HttpResponse.json({ data: { id: '42', username: 'omero' } }),
        ),
      );
      const res = await fetch(`${X_API_BASE}/2/users/me`);
      expect(await res.json()).toEqual({ data: { id: '42', username: 'omero' } });
    });
  });
});
