import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QueueSlotsService } from '../../src/settings/queue-slots.service';
import { createPost, createScheduledPost } from '../factories';
import { createTestApp, type TestApp } from '../helpers/app';
import { resetDb } from '../helpers/db';

const DAY = 24 * 3_600_000;
const allWeek = (localTime: string) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, localTime, enabled: true }));

describe('settings and queue slots API', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ env: { WORKERS_ENABLED: 'false' } });
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await resetDb(t.db);
  });

  describe('GET/PUT /settings', () => {
    it('returns defaults when nothing is stored', async () => {
      const res = await t.http().get('/api/v1/settings').expect(200);
      expect(res.body).toEqual({ timezone: 'UTC', missedGraceMinutes: 360 });
    });

    it('saves and returns settings', async () => {
      const body = { timezone: 'America/Argentina/Buenos_Aires', missedGraceMinutes: 120 };
      const put = await t.http().put('/api/v1/settings').send(body).expect(200);
      expect(put.body).toEqual(body);
      const get = await t.http().get('/api/v1/settings').expect(200);
      expect(get.body).toEqual(body);

      // Saving again overwrites (upsert), and the grace window defaults when omitted.
      await t.http().put('/api/v1/settings').send({ timezone: 'Europe/Madrid' }).expect(200);
      const again = await t.http().get('/api/v1/settings').expect(200);
      expect(again.body).toEqual({ timezone: 'Europe/Madrid', missedGraceMinutes: 360 });
    });

    it('rejects an unknown timezone with problem+json', async () => {
      const res = await t
        .http()
        .put('/api/v1/settings')
        .send({ timezone: 'Mars/Olympus_Mons', missedGraceMinutes: 60 })
        .expect(400)
        .expect('content-type', /application\/problem\+json/);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'timezone' })]),
      );
    });
  });

  describe('GET/PUT /queue-slots', () => {
    it('starts empty, replaces the whole set and returns it ordered', async () => {
      expect((await t.http().get('/api/v1/queue-slots').expect(200)).body).toEqual([]);

      await t
        .http()
        .put('/api/v1/queue-slots')
        .send([
          { weekday: 1, localTime: '09:00', enabled: true },
          { weekday: 2, localTime: '09:00', enabled: true },
        ])
        .expect(200);

      const replaced = await t
        .http()
        .put('/api/v1/queue-slots')
        .send([
          { weekday: 5, localTime: '18:00', enabled: false },
          { weekday: 1, localTime: '18:00' },
          { weekday: 1, localTime: '08:30', enabled: true },
        ])
        .expect(200);
      const expected = [
        { weekday: 1, localTime: '08:30', enabled: true },
        { weekday: 1, localTime: '18:00', enabled: true },
        { weekday: 5, localTime: '18:00', enabled: false },
      ];
      expect(replaced.body).toEqual(expected);
      expect((await t.http().get('/api/v1/queue-slots').expect(200)).body).toEqual(expected);
    });

    it('rejects duplicates and leaves the stored set untouched', async () => {
      await t
        .http()
        .put('/api/v1/queue-slots')
        .send([{ weekday: 1, localTime: '09:00' }])
        .expect(200);
      await t
        .http()
        .put('/api/v1/queue-slots')
        .send([
          { weekday: 3, localTime: '10:00' },
          { weekday: 3, localTime: '10:00' },
        ])
        .expect(400);
      await t
        .http()
        .put('/api/v1/queue-slots')
        .send([{ weekday: 7, localTime: '25:00' }])
        .expect(400);
      expect((await t.http().get('/api/v1/queue-slots').expect(200)).body).toEqual([
        { weekday: 1, localTime: '09:00', enabled: true },
      ]);
    });
  });

  describe('GET /queue-slots/next', () => {
    it('returns null without slots', async () => {
      const res = await t.http().get('/api/v1/queue-slots/next').expect(200);
      expect(res.body).toEqual({ scheduledAt: null });
    });

    it('previews the next free slot, skipping times taken by scheduled or publishing posts', async () => {
      // A daily 12:00 UTC slot: the next occurrences are at most 1 day apart.
      await t.http().put('/api/v1/queue-slots').send(allWeek('12:00')).expect(200);
      const first = (await t.http().get('/api/v1/queue-slots/next').expect(200)).body as {
        scheduledAt: string;
      };
      const firstAt = new Date(first.scheduledAt);
      expect(firstAt.getTime()).toBeGreaterThan(Date.now());
      expect(firstAt.getTime()).toBeLessThanOrEqual(Date.now() + DAY);
      expect(firstAt.getUTCHours()).toBe(12);
      expect(firstAt.getUTCMinutes()).toBe(0);

      // Drafts and published posts do not take slots; scheduled and publishing do.
      await createPost(t.db, { status: 'draft', scheduledAt: firstAt });
      expect((await t.http().get('/api/v1/queue-slots/next')).body).toEqual(first);
      await createScheduledPost(t.db, { scheduledAt: firstAt });
      const secondAt = new Date(firstAt.getTime() + DAY);
      await createPost(t.db, { status: 'publishing', scheduledAt: secondAt });

      const res = await t.http().get('/api/v1/queue-slots/next').expect(200);
      expect(res.body).toEqual({
        scheduledAt: new Date(firstAt.getTime() + 2 * DAY).toISOString(),
      });
    });

    it('interprets slots in the configured timezone', async () => {
      await t
        .http()
        .put('/api/v1/settings')
        .send({ timezone: 'Asia/Kolkata', missedGraceMinutes: 360 })
        .expect(200);
      await t.http().put('/api/v1/queue-slots').send(allWeek('09:00')).expect(200);

      const res = await t.http().get('/api/v1/queue-slots/next').expect(200);
      // 09:00 IST is 03:30 UTC.
      const at = new Date(res.body.scheduledAt as string);
      expect([at.getUTCHours(), at.getUTCMinutes()]).toEqual([3, 30]);
    });

    it('exposes the same computation to other modules, at an explicit instant', async () => {
      await t
        .http()
        .put('/api/v1/queue-slots')
        .send([{ weekday: 3, localTime: '09:00' }])
        .expect(200);
      const service = t.app.get(QueueSlotsService);
      // Wednesday 2030-01-02 08:00 UTC.
      const now = new Date('2030-01-02T08:00:00Z');
      expect(await service.findNextFreeSlot({ now })).toEqual(new Date('2030-01-02T09:00:00Z'));
      await createScheduledPost(t.db, { scheduledAt: new Date('2030-01-02T09:00:00Z') });
      expect(await service.findNextFreeSlot({ now })).toEqual(new Date('2030-01-09T09:00:00Z'));
    });
  });
});
