import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashSessionToken } from '../../src/auth/session-token';
import { UsersRepository } from '../../src/auth/users.repository';
import { sessions, users } from '../../src/db/schema';
import { createTestApp, type TestApp } from '../helpers/app';
import { createOwner, loginAs, resetThrottle, sessionSetCookie, TEST_OWNER } from '../helpers/auth';
import { resetDb } from '../helpers/db';

const SETUP = '/api/v1/auth/setup';
const LOGIN = '/api/v1/auth/login';

function tokenFrom(setCookie: string | undefined): string {
  const match = /^omero_session=([^;]+)/.exec(setCookie ?? '');
  if (!match) throw new Error(`no session cookie in ${setCookie}`);
  return match[1]!;
}

describe('auth: setup, login, logout', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ env: { WORKERS_ENABLED: 'false' } });
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await resetDb(t.db);
    await resetThrottle(t);
  });

  describe('setup', () => {
    it('reports needsSetup until the owner exists', async () => {
      const before = await t.http().get('/api/v1/auth/setup-status').expect(200);
      expect(before.body).toEqual({ needsSetup: true });
      await createOwner(t);
      const after = await t.http().get('/api/v1/auth/setup-status').expect(200);
      expect(after.body).toEqual({ needsSetup: false });
    });

    it('creates the owner once, logs it in, then answers 409 SETUP_ALREADY_DONE', async () => {
      const res = await t
        .http()
        .post(SETUP)
        .send({ username: ' Owner ', password: TEST_OWNER.password })
        .expect(201);
      expect(res.body).toEqual({ id: expect.any(String), username: 'owner' });

      const cookie = sessionSetCookie(res);
      expect(cookie).toMatch(/HttpOnly/);
      const me = await t
        .http()
        .get('/api/v1/auth/me')
        .set('Cookie', `omero_session=${tokenFrom(cookie)}`)
        .expect(200);
      expect(me.body).toEqual(res.body);

      const [stored] = await t.db.select().from(users);
      expect(stored!.passwordHash).toMatch(/^\$argon2id\$/);

      const again = await t
        .http()
        .post(SETUP)
        .send({ username: 'intruder', password: 'another long password' })
        .expect(409);
      expect(again.body).toMatchObject({ code: 'SETUP_ALREADY_DONE' });
      expect(sessionSetCookie(again)).toBeUndefined();
      expect(await t.db.select().from(users)).toHaveLength(1);
    });

    it('creates exactly one owner under concurrent setups', async () => {
      const results = await Promise.all(
        ['alice', 'bob', 'carol', 'dave', 'erin'].map((username) =>
          t.http().post(SETUP).send({ username, password: 'a sufficiently long password' }),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);
      expect(await t.db.select().from(users)).toHaveLength(1);
    });

    it('serializes owner creation in the repository (no hashing delay to hide the race)', async () => {
      const repo = t.app.get(UsersRepository);
      const created = await Promise.all(
        Array.from({ length: 10 }, (_, i) => repo.createFirstUser(`racer${i}`, 'not-a-real-hash')),
      );
      expect(created.filter(Boolean)).toHaveLength(1);
      expect(await t.db.select().from(users)).toHaveLength(1);
    });

    it('enforces the password policy (min 12 characters)', async () => {
      const res = await t
        .http()
        .post(SETUP)
        .send({ username: 'owner', password: 'short-pass1' })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual(['password']);
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await createOwner(t);
    });

    it('returns 204 with a session cookie that authenticates /auth/me', async () => {
      const res = await t
        .http()
        .post(LOGIN)
        .set('User-Agent', 'auth-test-browser')
        .send({ username: 'OWNER', password: TEST_OWNER.password })
        .expect(204);

      const cookie = sessionSetCookie(res)!;
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);
      expect(cookie).toMatch(/Path=\//);
      expect(cookie).toMatch(/Expires=/);
      // PUBLIC_BASE_URL is http in tests; see auth-security for the https case.
      expect(cookie).not.toMatch(/Secure/);

      const token = tokenFrom(cookie);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const [row] = await t.db.select().from(sessions);
      // Only the sha256 of the token is stored.
      expect(row!.id).toBe(hashSessionToken(token));
      expect(row!.id).not.toContain(token);
      expect(row!.userAgent).toBe('auth-test-browser');
      expect(row!.ip).toMatch(/127\.0\.0\.1|::1/);
      expect(row!.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 3600_000);

      const me = await t
        .http()
        .get('/api/v1/auth/me')
        .set('Cookie', `omero_session=${token}`)
        .expect(200);
      expect(me.body).toMatchObject({ username: 'owner' });
    });

    it.each([
      ['wrong password', { username: 'owner', password: 'not the password!' }],
      ['unknown user', { username: 'nobody', password: TEST_OWNER.password }],
    ])('rejects %s with 401 INVALID_CREDENTIALS', async (_case, body) => {
      const res = await t.http().post(LOGIN).send(body).expect(401);
      expect(res.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(sessionSetCookie(res)).toBeUndefined();
      expect(await t.db.select().from(sessions)).toHaveLength(0);
    });
  });

  describe('logout', () => {
    it('deletes the session row, clears the cookie and invalidates the token', async () => {
      const owner = await loginAs(t);
      await owner.http.get('/api/v1/auth/me').expect(200);

      const res = await owner.http.post('/api/v1/auth/logout').expect(204);
      expect(sessionSetCookie(res)).toMatch(/omero_session=;.*Expires=Thu, 01 Jan 1970/);
      expect(
        await t.db.select().from(sessions).where(eq(sessions.id, owner.sessionId)),
      ).toHaveLength(0);

      await t.http().get('/api/v1/auth/me').set('Cookie', owner.cookie).expect(401);
    });

    it('requires a session', async () => {
      await t.http().post('/api/v1/auth/logout').expect(401);
    });

    it('only ends the current session', async () => {
      const first = await loginAs(t);
      const second = await loginAs(t);
      await first.http.post('/api/v1/auth/logout').expect(204);
      await second.http.get('/api/v1/auth/me').expect(200);
    });
  });

  it('GET /auth/me returns 401 problem+json without a cookie or with a bogus one', async () => {
    const res = await t.http().get('/api/v1/auth/me').expect(401);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    await t.http().get('/api/v1/auth/me').set('Cookie', 'omero_session=garbage').expect(401);
    await t
      .http()
      .get('/api/v1/auth/me')
      .set('Cookie', `omero_session=${'A'.repeat(43)}`)
      .expect(401);
  });
});
