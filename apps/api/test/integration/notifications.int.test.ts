import { Job, type Queue, QueueEvents } from 'bullmq';
import { http, HttpResponse } from 'msw';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifications } from '../../src/db/schema';
import { TELEGRAM_API_BASE } from '../../src/notifications/telegram.client';
import { NotifyService } from '../../src/notifications/notify.service';
import { QUEUE } from '../../src/queues/queue.constants';
import { closeRedis, createRedisConnection } from '../../src/redis/redis-connection';
import { createTestApp, type TestApp } from '../helpers/app';
import { type AuthedAgent, loginAs } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { getQueue, obliterateQueues } from '../helpers/jobs';
import { server } from '../msw/server';
import { testInfra } from '../setup/test-env';

const BOT_TOKEN = '123456789:AAtest-token_value';
const CHAT_ID = '424242';
const SEND_MESSAGE_URL = `${TELEGRAM_API_BASE}/bot${BOT_TOKEN}/sendMessage`;
// A RegExp, because the colon in bot tokens would be read as a path parameter by msw.
const SEND_MESSAGE = /^https:\/\/api\.telegram\.org\/bot[^/]+\/sendMessage$/;
const POST_ID = '01900000-0000-7000-8000-000000000001';

interface SentMessage {
  url: string;
  body: {
    chat_id: string;
    text: string;
    parse_mode: string;
    disable_web_page_preview: boolean;
  };
}

/** Mocks sendMessage with the given statuses in order (the last one repeats). */
function mockTelegram(...statuses: number[]): SentMessage[] {
  const sent: SentMessage[] = [];
  server.use(
    http.post(SEND_MESSAGE, async ({ request }) => {
      sent.push({ url: request.url, body: (await request.json()) as SentMessage['body'] });
      const status = statuses[Math.min(sent.length - 1, statuses.length - 1)] ?? 200;
      if (status === 200) {
        return HttpResponse.json({ ok: true, result: { message_id: sent.length } });
      }
      return HttpResponse.json(
        { ok: false, error_code: status, description: `Error ${status}` },
        { status },
      );
    }),
  );
  return sent;
}

/** Waits until the job completes (resolves) or fails for good (rejects). */
async function waitForJob(queue: Queue, jobId: string, timeoutMs = 10_000): Promise<unknown> {
  const connection = createRedisConnection(testInfra().redisUrl, 'bullmq');
  const events = new QueueEvents(queue.name, { connection, prefix: queue.opts.prefix });
  try {
    await events.waitUntilReady();
    const job = await Job.fromId(queue, jobId);
    return await job!.waitUntilFinished(events, timeoutMs);
  } finally {
    await events.close();
    await closeRedis(connection);
  }
}

const deliveryFailed = {
  postId: POST_ID,
  provider: 'x' as const,
  reason: 'Service <unavailable> & retries exhausted',
  preview: 'Hola <b>mundo</b> & café',
  channelHandle: 'omero_dev',
};

describe('notifications with Telegram configured', () => {
  let t: TestApp;
  let owner: AuthedAgent;
  let queue: Queue;

  beforeAll(async () => {
    t = await createTestApp({
      env: { TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_CHAT_ID: CHAT_ID },
    });
    queue = getQueue(t.app, QUEUE.notify);
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await resetDb(t.db);
    owner = await loginAs(t);
    await obliterateQueues([queue]);
  });

  it('writes one row and delivers exactly one Telegram message', async () => {
    const sent = mockTelegram(200);
    const { notification, telegramJobId } = await t.app
      .get(NotifyService)
      .notify('delivery_failed', deliveryFailed);

    expect(telegramJobId).toBe(`telegram-${notification.id}`);
    expect(await waitForJob(queue, telegramJobId!)).toEqual({ sent: true, messageId: 1 });

    const rows = await t.db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'delivery_failed',
      severity: 'error',
      title: 'No se pudo publicar en X',
      link: `/posts/${POST_ID}`,
      readAt: null,
    });

    expect(sent).toHaveLength(1);
    const [msg] = sent;
    expect(msg!.url).toBe(SEND_MESSAGE_URL);
    expect(msg!.body).toMatchObject({
      chat_id: CHAT_ID,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    expect(msg!.body.text).toBe(
      [
        '❌ <b>No se pudo publicar en X</b>',
        [
          'Red: X (@omero_dev)',
          'Motivo: Service &lt;unavailable&gt; &amp; retries exhausted',
          'Publicación: «Hola &lt;b&gt;mundo&lt;/b&gt; &amp; café»',
        ].join('\n'),
        `Abrir en Omero: http://localhost:3000/posts/${POST_ID}`,
      ].join('\n\n'),
    );

    const job = await queue.getJob(telegramJobId!);
    expect(job!.opts).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
    });
  });

  it('retries a Telegram 500 and then delivers', async () => {
    const sent = mockTelegram(500, 200);
    const { telegramJobId } = await t.app.get(NotifyService).notify('post_missed', {
      postId: POST_ID,
      preview: 'Se cayó el server',
      scheduledAt: new Date('2026-11-02T12:00:00Z'),
    });

    // The first attempt fails and the job waits for its backoff; skip the wait.
    await vi.waitFor(
      async () => {
        const job = await queue.getJob(telegramJobId!);
        expect(job!.attemptsMade).toBe(1);
        expect(await job!.getState()).toBe('delayed');
      },
      { timeout: 5_000, interval: 50 },
    );
    await (await queue.getJob(telegramJobId!))!.promote();

    expect(await waitForJob(queue, telegramJobId!)).toEqual({ sent: true, messageId: 2 });
    expect(sent).toHaveLength(2);
    expect(sent[0]!.body).toEqual(sent[1]!.body);
    expect(await t.db.select().from(notifications)).toHaveLength(1);
  });

  it('does not retry a Telegram 4xx rejection and never leaks the token', async () => {
    const sent = mockTelegram(400);
    const { telegramJobId } = await t.app
      .get(NotifyService)
      .notify('channel_reauth', { provider: 'linkedin', channelHandle: 'Ada Lovelace' });

    await expect(waitForJob(queue, telegramJobId!)).rejects.toThrow(/HTTP 400/);
    const job = await queue.getJob(telegramJobId!);
    expect(job!.attemptsMade).toBe(1);
    expect(job!.failedReason).not.toContain(BOT_TOKEN);
    expect(JSON.stringify(job!.stacktrace)).not.toContain(BOT_TOKEN);
    expect(JSON.stringify(job!.data)).not.toContain(BOT_TOKEN);
    expect(sent).toHaveLength(1);
  });
});

describe('notifications without Telegram', () => {
  let t: TestApp;
  let owner: AuthedAgent;

  beforeAll(async () => {
    t = await createTestApp({
      env: { TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: undefined },
    });
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await resetDb(t.db);
    owner = await loginAs(t);
    await obliterateQueues([getQueue(t.app, QUEUE.notify)]);
  });

  it('only creates the row and makes no request', async () => {
    const sent = mockTelegram(200);
    const result = await t.app.get(NotifyService).notify('token_expiring', {
      provider: 'linkedin',
      channelHandle: 'Ada Lovelace',
      expiresAt: new Date('2026-11-05T15:00:00Z'),
    });

    expect(result.telegramJobId).toBeUndefined();
    expect(await getQueue(t.app, QUEUE.notify).count()).toBe(0);
    const rows = await t.db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'token_expiring',
      severity: 'warning',
      link: '/settings/channels',
    });
    expect(sent).toHaveLength(0);
  });

  describe('HTTP endpoints', () => {
    const create = (title: string) =>
      t.app.get(NotifyService).notify('delivery_failed', { ...deliveryFailed, reason: title });

    it('lists newest first, filters unread and paginates', async () => {
      const a = (await create('a')).notification;
      const b = (await create('b')).notification;
      const c = (await create('c')).notification;

      const all = await owner.http.get('/api/v1/notifications').expect(200);
      expect(all.body.items.map((n: { id: string }) => n.id)).toEqual([c.id, b.id, a.id]);
      expect(all.body).toMatchObject({ nextCursor: null, unreadCount: 3 });
      expect(all.body.items[0]).toMatchObject({
        type: 'delivery_failed',
        severity: 'error',
        readAt: null,
        createdAt: expect.stringMatching(/Z$/),
      });

      const page1 = await owner.http.get('/api/v1/notifications?limit=2').expect(200);
      expect(page1.body.items.map((n: { id: string }) => n.id)).toEqual([c.id, b.id]);
      expect(page1.body.nextCursor).toBe(b.id);
      const page2 = await owner.http
        .get(`/api/v1/notifications?limit=2&cursor=${page1.body.nextCursor}`)
        .expect(200);
      expect(page2.body.items.map((n: { id: string }) => n.id)).toEqual([a.id]);
      expect(page2.body.nextCursor).toBeNull();

      const read = await owner.http.post(`/api/v1/notifications/${b.id}/read`).expect(200);
      expect(read.body).toMatchObject({ id: b.id, readAt: expect.any(String) });

      const unread = await owner.http.get('/api/v1/notifications?unread=true').expect(200);
      expect(unread.body.items.map((n: { id: string }) => n.id)).toEqual([c.id, a.id]);
      expect(unread.body.unreadCount).toBe(2);

      const readAll = await owner.http.post('/api/v1/notifications/read-all').expect(200);
      expect(readAll.body).toEqual({ count: 2 });
      const none = await owner.http.get('/api/v1/notifications?unread=true').expect(200);
      expect(none.body).toMatchObject({ items: [], unreadCount: 0 });
    });

    it('keeps the first read time when marking twice', async () => {
      const { notification } = await create('x');
      const first = await owner.http.post(`/api/v1/notifications/${notification.id}/read`);
      const second = await owner.http.post(`/api/v1/notifications/${notification.id}/read`);
      expect(second.body.readAt).toBe(first.body.readAt);
    });

    it('returns 404 for an unknown id and 400 for a malformed one', async () => {
      const res = await owner.http
        .post('/api/v1/notifications/01900000-0000-7000-8000-00000000ffff/read')
        .expect(404)
        .expect('content-type', /application\/problem\+json/);
      expect(res.body.code).toBe('NOT_FOUND');
      await owner.http.post('/api/v1/notifications/not-a-uuid/read').expect(400);
      await owner.http.get('/api/v1/notifications?limit=0').expect(400);
    });
  });
});
