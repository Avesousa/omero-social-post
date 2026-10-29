import { eq } from 'drizzle-orm';
import { type Redis } from 'ioredis';
import request from 'supertest';
import { SESSION_COOKIE, THROTTLE_KEY_PREFIX } from '../../src/auth/auth.constants';
import { PasswordService } from '../../src/auth/password.service';
import { SessionService } from '../../src/auth/session.service';
import { users } from '../../src/db/schema';
import { REDIS_CLIENT } from '../../src/redis/redis.module';
import { type HttpAgent, type TestApp } from './app';

export interface TestCredentials {
  username: string;
  password: string;
}

/** Default owner used by `loginAs` / `createOwner`. */
export const TEST_OWNER: TestCredentials = {
  username: 'owner',
  password: 'correct horse battery staple',
};

export type User = typeof users.$inferSelect;

/** Inserts a user with an argon2id hash (bypasses /auth/setup). Reuses it if present. */
export async function createOwner(t: TestApp, creds: TestCredentials = TEST_OWNER): Promise<User> {
  const [existing] = await t.db.select().from(users).where(eq(users.username, creds.username));
  if (existing) return existing;
  const passwordHash = await t.app.get(PasswordService).hash(creds.password);
  const [row] = await t.db
    .insert(users)
    .values({ username: creds.username, passwordHash })
    .returning();
  return row!;
}

export interface AuthedAgent {
  /** supertest agent sending the session cookie and a same-site `Origin` on every request. */
  http: HttpAgent;
  user: User;
  /** Raw cookie token. */
  token: string;
  /** `sessions.id` (sha256 of the token), the value exposed as `req.session.sessionId`. */
  sessionId: string;
  /** `omero_session=<token>`, for building requests by hand. */
  cookie: string;
}

/**
 * Returns an authenticated agent for `t`, creating the owner if needed. The session is
 * created through SessionService (not POST /auth/login), so it is fast and never
 * consumes the login throttle budget.
 *
 * @example
 *   const owner = await loginAs(t);
 *   await owner.http.get('/api/v1/auth/me').expect(200);
 */
export async function loginAs(
  t: TestApp,
  creds: TestCredentials = TEST_OWNER,
): Promise<AuthedAgent> {
  const user = await createOwner(t, creds);
  const { token, sessionId } = await t.app
    .get(SessionService)
    .create(user.id, { userAgent: 'vitest', ip: '127.0.0.1' });
  const cookie = `${SESSION_COOKIE}=${token}`;
  const http = request
    .agent(t.app.getHttpServer())
    .set('Origin', t.env.PUBLIC_BASE_URL)
    .set('Cookie', cookie);
  return { http, user, token, sessionId, cookie };
}

/** Extracts the `omero_session` Set-Cookie line from a response, if any. */
export function sessionSetCookie(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers['set-cookie'];
  const lines = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  return lines.find((line) => line.startsWith(`${SESSION_COOKIE}=`));
}

/** Clears login throttle counters (they live in Redis and outlive resetDb). */
export async function resetThrottle(t: TestApp): Promise<void> {
  const redis = t.app.get<Redis>(REDIS_CLIENT);
  const keys = await redis.keys(`${THROTTLE_KEY_PREFIX}*`);
  if (keys.length > 0) await redis.del(...keys);
}
