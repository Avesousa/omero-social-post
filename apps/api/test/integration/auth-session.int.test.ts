import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sessions, users } from '../../src/db/schema';
import { createTestApp, type TestApp } from '../helpers/app';
import { loginAs, sessionSetCookie } from '../helpers/auth';
import { resetDb } from '../helpers/db';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('auth: session lifetime', () => {
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

  async function setTimes(sessionId: string, times: { lastSeenAt: Date; expiresAt: Date }) {
    await t.db.update(sessions).set(times).where(eq(sessions.id, sessionId));
  }

  async function getRow(sessionId: string) {
    const [row] = await t.db.select().from(sessions).where(eq(sessions.id, sessionId));
    return row;
  }

  it('slides the expiry to now + 30 days when last renewed over an hour ago', async () => {
    const owner = await loginAs(t);
    const oldExpiry = new Date(Date.now() + DAY);
    await setTimes(owner.sessionId, {
      lastSeenAt: new Date(Date.now() - 2 * HOUR),
      expiresAt: oldExpiry,
    });

    const res = await owner.http.get('/api/v1/auth/me').expect(200);

    const row = await getRow(owner.sessionId);
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29.9 * DAY);
    expect(Date.now() - row!.lastSeenAt.getTime()).toBeLessThan(MINUTE);
    // The cookie is re-issued with the same token and the new expiry.
    const cookie = sessionSetCookie(res);
    expect(cookie).toContain(owner.cookie);
    const expires = new Date(/Expires=([^;]+)/.exec(cookie!)![1]!);
    expect(Math.abs(expires.getTime() - row!.expiresAt.getTime())).toBeLessThan(2000);
  });

  it('does not write on every request: no renewal within the hour', async () => {
    const owner = await loginAs(t);
    const lastSeenAt = new Date(Date.now() - 30 * MINUTE);
    const expiresAt = new Date(Date.now() + DAY);
    await setTimes(owner.sessionId, { lastSeenAt, expiresAt });

    const res = await owner.http.get('/api/v1/auth/me').expect(200);

    expect(sessionSetCookie(res)).toBeUndefined();
    const row = await getRow(owner.sessionId);
    expect(row!.expiresAt.getTime()).toBe(expiresAt.getTime());
    expect(row!.lastSeenAt.getTime()).toBe(lastSeenAt.getTime());
  });

  it('rejects an expired session with 401 and deletes its row', async () => {
    const owner = await loginAs(t);
    await setTimes(owner.sessionId, {
      lastSeenAt: new Date(Date.now() - 31 * DAY),
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await owner.http.get('/api/v1/auth/me').expect(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await getRow(owner.sessionId)).toBeUndefined();
  });

  it('kills sessions when the user is deleted (FK cascade)', async () => {
    const owner = await loginAs(t);
    await t.db.delete(users).where(eq(users.id, owner.user.id));
    expect(await getRow(owner.sessionId)).toBeUndefined();
    await owner.http.get('/api/v1/auth/me').expect(401);
  });
});
