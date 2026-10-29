import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';
import { API_PREFIX } from '../../src/openapi';
import { createTestApp, type TestApp } from '../helpers/app';
import { createOwner, loginAs, resetThrottle, sessionSetCookie, TEST_OWNER } from '../helpers/auth';
import { resetDb } from '../helpers/db';

const LOGIN = '/api/v1/auth/login';
const FOREIGN = 'https://evil.example';

interface DiscoveredRoute {
  method: string;
  path: string;
  isPublic: boolean;
}

/** Every Nest route (controller method) with its full path and @Public() flag. */
function discoverRoutes(t: TestApp): DiscoveredRoute[] {
  const discovery = t.app.get(DiscoveryService);
  const reflector = t.app.get(Reflector);
  const scanner = new MetadataScanner();
  const routes: DiscoveredRoute[] = [];

  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const controllerPaths = ([] as string[]).concat(
      (Reflect.getMetadata(PATH_METADATA, metatype) as string | string[] | undefined) ?? '/',
    );
    const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name] as (...args: unknown[]) => unknown;
      const routePaths = Reflect.getMetadata(PATH_METADATA, handler) as
        string | string[] | undefined;
      if (routePaths === undefined) continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
      const isPublic =
        reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [handler, metatype]) ===
        true;
      for (const c of controllerPaths) {
        for (const r of ([] as string[]).concat(routePaths)) {
          const path = `/${[API_PREFIX, c, r].join('/')}`.replace(/\/+/g, '/').replace(/\/$/, '');
          routes.push({ method: RequestMethod[method], path, isPublic });
        }
      }
    }
  }
  return routes;
}

/** Fills `:params` and wildcards with a syntactically valid UUIDv7. */
function concretePath(path: string): string {
  const id = '01900000-0000-7000-8000-000000000000';
  return path.replace(/:[A-Za-z0-9_]+/g, id).replace(/\{?\*[A-Za-z0-9_]*\}?/g, 'x');
}

describe('auth: security', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ env: { WORKERS_ENABLED: 'false' }, imports: [DiscoveryModule] });
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await resetDb(t.db);
    await resetThrottle(t);
  });

  describe('login throttling (5 attempts / 15 min per IP + username)', () => {
    beforeEach(async () => {
      await createOwner(t);
    });

    it('answers the 6th attempt with 429, even with the right password', async () => {
      for (let i = 0; i < 5; i++) {
        await t
          .http()
          .post(LOGIN)
          .send({ username: 'owner', password: `wrong password ${i}` })
          .expect(401);
      }
      const blocked = await t.http().post(LOGIN).send(TEST_OWNER).expect(429);
      expect(blocked.body).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
      expect(Number(blocked.headers['retry-after-login'])).toBeGreaterThan(14 * 60);
      expect(sessionSetCookie(blocked)).toBeUndefined();
    });

    it('counts per username (case-insensitive), not per IP alone', async () => {
      for (let i = 0; i < 5; i++) {
        await t
          .http()
          .post(LOGIN)
          .send({ username: i % 2 ? 'OWNER' : 'owner', password: 'nope nope nope' })
          .expect(401);
      }
      await t
        .http()
        .post(LOGIN)
        .send({ username: 'owner', password: 'nope nope nope' })
        .expect(429);
      // Another username from the same IP still has its own budget.
      await t
        .http()
        .post(LOGIN)
        .send({ username: 'someone-else', password: 'nope nope nope' })
        .expect(401);
    });

    it('does not throttle other routes', async () => {
      for (let i = 0; i < 8; i++) {
        await t.http().get('/api/v1/auth/setup-status').expect(200);
      }
    });
  });

  describe('Origin / Referer check on mutating requests', () => {
    it('rejects a foreign Origin with 403 before the handler runs', async () => {
      const res = await t
        .rawHttp()
        .post('/api/v1/auth/setup')
        .set('Origin', FOREIGN)
        .send({ username: 'owner', password: TEST_OWNER.password })
        .expect(403);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body).toMatchObject({ status: 403, code: 'FORBIDDEN' });
      const status = await t.http().get('/api/v1/auth/setup-status').expect(200);
      expect(status.body.needsSetup).toBe(true);
    });

    it('rejects requests with neither Origin nor Referer', async () => {
      await t.rawHttp().post(LOGIN).send(TEST_OWNER).expect(403);
    });

    it('rejects a foreign Origin even with a valid session', async () => {
      const owner = await loginAs(t);
      await owner.http.post('/api/v1/auth/logout').set('Origin', FOREIGN).expect(403);
      await owner.http.get('/api/v1/auth/me').expect(200);
    });

    it('accepts a same-origin Referer when Origin is absent', async () => {
      await createOwner(t);
      await t
        .rawHttp()
        .post(LOGIN)
        .set('Referer', `${t.env.PUBLIC_BASE_URL}/login`)
        .send(TEST_OWNER)
        .expect(204);
    });

    it('lets safe methods through with a foreign Origin', async () => {
      await t.rawHttp().get('/api/v1/auth/setup-status').set('Origin', FOREIGN).expect(200);
    });

    it('also guards Bull Board actions', async () => {
      const owner = await loginAs(t);
      await owner.http
        .put('/api/v1/admin/queues/api/queues/maintenance/retry/failed')
        .set('Origin', FOREIGN)
        .expect(403);
    });
  });

  describe('route table', () => {
    it('has exactly the expected public routes', () => {
      const publicRoutes = discoverRoutes(t)
        .filter((r) => r.isPublic)
        .map((r) => `${r.method} ${r.path}`)
        .sort();
      // Adding a public route is a security decision: update this list deliberately.
      expect(publicRoutes).toEqual([
        'GET /api/v1/auth/setup-status',
        'GET /api/v1/health',
        'POST /api/v1/auth/login',
        'POST /api/v1/auth/setup',
      ]);
    });

    it('answers 401 on every non-public route without a cookie', async () => {
      const routes = discoverRoutes(t).filter((r) => !r.isPublic);
      expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(
        expect.arrayContaining(['GET /api/v1/auth/me', 'POST /api/v1/auth/logout']),
      );

      const failures: string[] = [];
      for (const route of routes) {
        const method = (route.method === 'ALL' ? 'GET' : route.method).toLowerCase() as
          'get' | 'post' | 'put' | 'patch' | 'delete';
        const res = await t.http()[method](concretePath(route.path)).send({});
        if (res.status !== 401) failures.push(`${route.method} ${route.path} -> ${res.status}`);
      }
      expect(failures).toEqual([]);
    });
  });

  describe('non-Nest routes', () => {
    it('protects Bull Board with the session', async () => {
      const res = await t.http().get('/api/v1/admin/queues').expect(401);
      expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
      await t.http().get('/api/v1/admin/queues/api/queues').expect(401);

      const owner = await loginAs(t);
      await owner.http.get('/api/v1/admin/queues/api/queues').expect(200);
      const ui = await owner.http.get('/api/v1/admin/queues').expect(200);
      expect(ui.headers['content-type']).toMatch(/text\/html/);
    });

    it('requires a session for openapi.json outside development', async () => {
      await t.http().get('/api/v1/openapi.json').expect(401);
      const owner = await loginAs(t);
      const res = await owner.http.get('/api/v1/openapi.json').expect(200);
      expect(Object.keys(res.body.paths)).toEqual(
        expect.arrayContaining([
          '/api/v1/auth/setup-status',
          '/api/v1/auth/setup',
          '/api/v1/auth/login',
          '/api/v1/auth/logout',
          '/api/v1/auth/me',
        ]),
      );
    });

    it('keeps health public', async () => {
      await t.http().get('/api/v1/health').expect(200);
    });
  });
});

describe('auth: environment-dependent behaviour', () => {
  it('serves openapi.json without a session in development', async () => {
    const t = await createTestApp({
      env: { NODE_ENV: 'development', WORKERS_ENABLED: 'false', LOG_LEVEL: 'silent' },
    });
    try {
      await t.http().get('/api/v1/openapi.json').expect(200);
      await t.http().get('/api/v1/auth/me').expect(401);
    } finally {
      await t.close();
    }
  });

  it('marks the cookie Secure when PUBLIC_BASE_URL is https', async () => {
    const t = await createTestApp({
      env: { PUBLIC_BASE_URL: 'https://omero.example.ts.net', WORKERS_ENABLED: 'false' },
    });
    try {
      await resetDb(t.db);
      const res = await t
        .http()
        .post('/api/v1/auth/setup')
        .send({ username: 'owner', password: TEST_OWNER.password })
        .expect(201);
      expect(sessionSetCookie(res)).toMatch(/; Secure/);
    } finally {
      await resetDb(t.db);
      await t.close();
    }
  });
});
