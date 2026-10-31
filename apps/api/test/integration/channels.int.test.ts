import { eq } from 'drizzle-orm';
import { delay, http, HttpResponse } from 'msw';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TokenService } from '../../src/channels/token.service';
import { channels, deliveries, notifications } from '../../src/db/schema';
import { OAuthStateStore, ReauthRequired } from '../../src/providers';
import { X_API_BASE } from '../../src/providers/x/x.constants';
import { createChannel, createDelivery } from '../factories';
import { createTestApp, type TestApp } from '../helpers/app';
import { type AuthedAgent, loginAs } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { server } from '../msw/server';
import { X_FIXTURES } from '../msw/handlers/x';
import { testCipher } from '../setup/test-env';

const API = '/api/v1/channels';
const SETTINGS = 'http://localhost:3000/settings/channels';

function stateFrom(location: string): string {
  const state = new URL(location).searchParams.get('state');
  if (!state) throw new Error(`No state in ${location}`);
  return state;
}

describe('channels', () => {
  let t: TestApp;
  let owner: AuthedAgent;

  beforeAll(async () => {
    t = await createTestApp({
      env: {
        WORKERS_ENABLED: 'false',
        X_CLIENT_ID: 'x-client-id',
        X_CLIENT_SECRET: 'x-client-secret',
        LINKEDIN_CLIENT_ID: undefined,
        LINKEDIN_CLIENT_SECRET: undefined,
      },
    });
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await resetDb(t.db);
    owner = await loginAs(t);
  });

  /** GET connect, returns the `state` the consent URL carries. */
  async function startConnect(agent: AuthedAgent = owner, provider = 'x'): Promise<string> {
    const res = await agent.http.get(`${API}/${provider}/connect`).expect(302);
    return stateFrom(res.headers.location as string);
  }

  /** Full happy path: connect, then the network redirects back with a code. */
  async function connectX(code = 'auth-code'): Promise<void> {
    const state = await startConnect();
    const res = await owner.http.get(`${API}/x/callback`).query({ code, state }).expect(302);
    expect(res.headers.location).toBe(`${SETTINGS}?connected=x`);
  }

  describe('connect and callback', () => {
    it('GET /channels/x/connect redirects to the consent screen with state and PKCE', async () => {
      const res = await owner.http.get(`${API}/x/connect`).expect(302);
      const url = new URL(res.headers.location as string);
      expect(url.origin + url.pathname).toBe('https://x.com/i/oauth2/authorize');
      expect(url.searchParams.get('client_id')).toBe('x-client-id');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3000/api/v1/channels/x/callback',
      );
      expect(url.searchParams.get('state')).toMatch(/^[\w-]{43}$/);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
    });

    it('requires a session and answers 409 CHANNEL_NOT_CONFIGURED for an unconfigured provider', async () => {
      await t.http().get(`${API}/x/connect`).expect(401);
      const res = await owner.http.get(`${API}/linkedin/connect`).expect(409);
      expect(res.body).toMatchObject({ code: 'CHANNEL_NOT_CONFIGURED' });
      await owner.http.get(`${API}/mastodon/connect`).expect(400);
    });

    it('creates exactly one channel from the callback', async () => {
      await connectX();
      const list = await owner.http.get(API).expect(200);
      expect(list.body).toEqual([
        {
          id: expect.any(String),
          provider: 'x',
          externalId: X_FIXTURES.user.id,
          handle: 'omero_dev',
          displayName: 'Omero Dev',
          avatarUrl: X_FIXTURES.user.profile_image_url,
          status: 'connected',
          settings: { longPostsEnabled: false },
          tokenExpiresAt: expect.any(String),
          createdAt: expect.any(String),
        },
      ]);
    });

    it('reconnecting the same account updates the same row and keeps its settings', async () => {
      await connectX();
      const [first] = await t.db.select().from(channels);
      await owner.http
        .patch(`${API}/${first!.id}`)
        .send({ settings: { longPostsEnabled: true } })
        .expect(200);
      // The account renamed itself in between.
      await t.db.update(channels).set({ handle: 'old_handle' }).where(eq(channels.id, first!.id));

      await connectX();
      const rows = await t.db.select().from(channels);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: first!.id,
        handle: 'omero_dev',
        status: 'connected',
        settings: { longPostsEnabled: true },
      });
    });

    it('stores tokens as ciphertext and never returns them', async () => {
      await connectX();
      const [row] = await t.db.select().from(channels);
      expect(row!.accessTokenEnc).toMatch(/^v1:/);
      expect(row!.refreshTokenEnc).toMatch(/^v1:/);
      expect(row!.accessTokenEnc).not.toContain(X_FIXTURES.token.access_token);
      expect(row!.refreshTokenEnc).not.toContain(X_FIXTURES.token.refresh_token);
      const cipher = testCipher();
      expect(cipher.decrypt(row!.accessTokenEnc!)).toBe(X_FIXTURES.token.access_token);
      expect(cipher.decrypt(row!.refreshTokenEnc!)).toBe(X_FIXTURES.token.refresh_token);
      expect(row!.scopes).toEqual(X_FIXTURES.token.scope.split(' '));
      expect(row!.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 1000);

      const res = await owner.http.get(API).expect(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(X_FIXTURES.token.access_token);
      expect(body).not.toContain(X_FIXTURES.token.refresh_token);
      expect(body).not.toContain('v1:');
      expect(Object.keys((res.body as object[])[0]!)).not.toContain('accessTokenEnc');
    });

    it.each([
      ['an unknown state', () => Promise.resolve('does-not-exist'), 'state_invalid'],
      ['no state', () => Promise.resolve(''), 'state_invalid'],
      [
        'an expired state',
        async () => {
          const created = await t.app
            .get(OAuthStateStore)
            .create('x', owner.sessionId, '/settings/channels', 1);
          await new Promise((resolve) => setTimeout(resolve, 1_200));
          return created.state;
        },
        'state_invalid',
      ],
      [
        'a state created by another session',
        async () => {
          const other = await loginAs(t);
          return startConnect(other);
        },
        'state_mismatch',
      ],
    ])('redirects with ?error= for %s', async (_name, makeState, error) => {
      const state = await makeState();
      const res = await owner.http.get(`${API}/x/callback`).query({ code: 'c', state }).expect(302);
      expect(res.headers.location).toBe(`${SETTINGS}?error=${error}`);
      expect(await t.db.select().from(channels)).toHaveLength(0);
    });

    it('a state can only be used once', async () => {
      const state = await startConnect();
      await owner.http.get(`${API}/x/callback`).query({ code: 'c', state }).expect(302);
      const replay = await owner.http
        .get(`${API}/x/callback`)
        .query({ code: 'c', state })
        .expect(302);
      expect(replay.headers.location).toBe(`${SETTINGS}?error=state_invalid`);
      expect(await t.db.select().from(channels)).toHaveLength(1);
    });

    it('redirects with ?error=access_denied when the owner denies access', async () => {
      const state = await startConnect();
      const res = await owner.http
        .get(`${API}/x/callback`)
        .query({ error: 'access_denied', error_description: 'nope', state })
        .expect(302);
      expect(res.headers.location).toBe(`${SETTINGS}?error=access_denied`);
      expect(await t.db.select().from(channels)).toHaveLength(0);
    });

    it('redirects with ?error=exchange_failed when the network rejects the code', async () => {
      const state = await startConnect();
      const res = await owner.http
        .get(`${API}/x/callback`)
        .query({ code: X_FIXTURES.badCode, state })
        .expect(302);
      expect(res.headers.location).toBe(`${SETTINGS}?error=exchange_failed`);
      expect(await t.db.select().from(channels)).toHaveLength(0);
    });

    it('redirects with ?error=missing_code and never answers JSON for odd queries', async () => {
      const state = await startConnect();
      const res = await owner.http.get(`${API}/x/callback`).query({ state }).expect(302);
      expect(res.headers.location).toBe(`${SETTINGS}?error=missing_code`);
      // A repeated parameter is not a string; it must still end in a redirect.
      const odd = await owner.http.get(`${API}/x/callback?code=a&code=b&state=zzz`).expect(302);
      expect(odd.headers.location).toBe(`${SETTINGS}?error=state_invalid`);
    });
  });

  describe('PATCH /channels/:id', () => {
    it('updates the settings', async () => {
      const channel = await createChannel(t.db);
      const res = await owner.http
        .patch(`${API}/${channel.id}`)
        .send({ settings: { longPostsEnabled: true } })
        .expect(200);
      expect(res.body).toMatchObject({ id: channel.id, settings: { longPostsEnabled: true } });
      const [row] = await t.db.select().from(channels).where(eq(channels.id, channel.id));
      expect(row!.settings).toEqual({ longPostsEnabled: true });
    });

    it('rejects an invalid body and answers 404 for an unknown channel', async () => {
      const channel = await createChannel(t.db);
      await owner.http
        .patch(`${API}/${channel.id}`)
        .send({ settings: { longPostsEnabled: 'yes' } })
        .expect(400);
      await owner.http
        .patch(`${API}/01900000-0000-7000-8000-000000000000`)
        .send({ settings: { longPostsEnabled: true } })
        .expect(404);
    });
  });

  describe('DELETE /channels/:id', () => {
    it('wipes tokens, keeps the row and flags pending deliveries; reconnecting clears the flag', async () => {
      await connectX();
      const [channel] = await t.db.select().from(channels);
      const pending = await createDelivery(t.db, { channelId: channel!.id, status: 'pending' });
      const published = await createDelivery(t.db, {
        channelId: channel!.id,
        status: 'published',
      });
      const otherChannel = await createChannel(t.db);
      const unrelated = await createDelivery(t.db, { channelId: otherChannel.id });

      await owner.http.delete(`${API}/${channel!.id}`).expect(204);

      const [row] = await t.db.select().from(channels).where(eq(channels.id, channel!.id));
      expect(row).toMatchObject({
        status: 'disconnected',
        accessTokenEnc: null,
        refreshTokenEnc: null,
        tokenExpiresAt: null,
        refreshExpiresAt: null,
      });
      const flags = async () =>
        Object.fromEntries(
          (await t.db.select().from(deliveries)).map((d) => [d.id, d.needsAttention]),
        );
      expect(await flags()).toEqual({
        [pending.id]: true,
        [published.id]: false,
        [unrelated.id]: false,
      });
      // Idempotent.
      await owner.http.delete(`${API}/${channel!.id}`).expect(204);

      await connectX();
      // The same row is reused: only the unrelated channel is added next to it.
      const rows = await t.db.select().from(channels).where(eq(channels.provider, 'x'));
      expect(rows.map((r) => r.id).sort()).toEqual([channel!.id, otherChannel.id].sort());
      const reconnected = rows.find((r) => r.id === channel!.id)!;
      expect(reconnected.status).toBe('connected');
      expect(reconnected.accessTokenEnc).toMatch(/^v1:/);
      expect(await flags()).toEqual({
        [pending.id]: false,
        [published.id]: false,
        [unrelated.id]: false,
      });
    });

    it('answers 404 for an unknown channel', async () => {
      await owner.http.delete(`${API}/01900000-0000-7000-8000-000000000000`).expect(404);
    });
  });

  describe('TokenService.getValidContext', () => {
    const minutes = (n: number) => new Date(Date.now() + n * 60_000);

    /** Counts refresh-token grants and answers with a rotated pair after a short delay. */
    function mockRefresh(): string[] {
      const seen: string[] = [];
      server.use(
        http.post(`${X_API_BASE}/2/oauth2/token`, async ({ request }) => {
          const form = new URLSearchParams(await request.text());
          if (form.get('grant_type') !== 'refresh_token') return;
          seen.push(form.get('refresh_token') ?? '');
          await delay(150);
          return HttpResponse.json({
            ...X_FIXTURES.token,
            access_token: 'rotated-access',
            refresh_token: 'rotated-refresh',
          });
        }),
      );
      return seen;
    }

    it('returns the stored tokens when they are not close to expiring', async () => {
      const refreshes = mockRefresh();
      const channel = await createChannel(t.db, {
        externalId: '42',
        handle: 'someone',
        tokenExpiresAt: minutes(60),
        accessTokenEnc: testCipher().encrypt('stored-access'),
      });
      const result = await t.app.get(TokenService).getValidContext(channel.id);
      expect(refreshes).toHaveLength(0);
      expect(result.adapter.id).toBe('x');
      expect(result.context.account).toEqual({ externalId: '42', handle: 'someone' });
      expect(result.context.tokens.accessToken).toBe('stored-access');
      expect(result.channel).toMatchObject({ id: channel.id, status: 'connected' });
      expect(JSON.stringify(result.channel)).not.toContain('stored-access');
    });

    it('refreshes near expiry; two concurrent calls trigger exactly one refresh request', async () => {
      const refreshes = mockRefresh();
      const channel = await createChannel(t.db, {
        tokenExpiresAt: minutes(1),
        refreshTokenEnc: testCipher().encrypt('old-refresh'),
      });
      const service = t.app.get(TokenService);

      const [a, b] = await Promise.all([
        service.getValidContext(channel.id),
        service.getValidContext(channel.id),
      ]);

      expect(refreshes).toEqual(['old-refresh']);
      expect(a.context.tokens.accessToken).toBe('rotated-access');
      expect(b.context.tokens.accessToken).toBe('rotated-access');
      // The rotated pair is persisted, encrypted.
      const [row] = await t.db.select().from(channels).where(eq(channels.id, channel.id));
      const cipher = testCipher();
      expect(cipher.decrypt(row!.accessTokenEnc!)).toBe('rotated-access');
      expect(cipher.decrypt(row!.refreshTokenEnc!)).toBe('rotated-refresh');
      expect(row!.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 1000);

      // A later call uses the fresh token without refreshing again.
      await service.getValidContext(channel.id);
      expect(refreshes).toHaveLength(1);
    });

    it('ReauthRequired marks needs_reconnect and raises exactly one notification', async () => {
      const channel = await createChannel(t.db, {
        handle: 'revoked_user',
        tokenExpiresAt: minutes(1),
        refreshTokenEnc: testCipher().encrypt(X_FIXTURES.revokedRefreshToken),
      });
      const service = t.app.get(TokenService);

      const results = await Promise.allSettled([
        service.getValidContext(channel.id),
        service.getValidContext(channel.id),
      ]);
      expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
      for (const r of results) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ReauthRequired);
      }

      const [row] = await t.db.select().from(channels).where(eq(channels.id, channel.id));
      expect(row!.status).toBe('needs_reconnect');
      const rows = await t.db.select().from(notifications);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: 'channel_reauth', severity: 'error' });
      expect(rows[0]!.body).toContain('revoked_user');

      // Later calls fail fast without another notification or provider request.
      await expect(service.getValidContext(channel.id)).rejects.toMatchObject({
        code: 'CHANNEL_NEEDS_RECONNECT',
      });
      expect(await service.markNeedsReconnect(channel.id, 'again')).toBe(false);
      expect(await t.db.select().from(notifications)).toHaveLength(1);
    });

    it('markNeedsReconnect is for the worker: one transition, one notification', async () => {
      const channel = await createChannel(t.db);
      const service = t.app.get(TokenService);
      expect(await service.markNeedsReconnect(channel.id, 'Token rejected by X')).toBe(true);
      expect(await service.markNeedsReconnect(channel.id, 'Token rejected by X')).toBe(false);
      expect(await t.db.select().from(notifications)).toHaveLength(1);
      // Reconnecting re-arms it.
      await t.db.update(channels).set({ status: 'connected' }).where(eq(channels.id, channel.id));
      expect(await service.markNeedsReconnect(channel.id, 'Token rejected by X')).toBe(true);
      expect(await t.db.select().from(notifications)).toHaveLength(2);
    });

    it('does not touch a disconnected channel and refuses to use it', async () => {
      const channel = await createChannel(t.db, { status: 'disconnected' });
      const service = t.app.get(TokenService);
      expect(await service.markNeedsReconnect(channel.id, 'x')).toBe(false);
      await expect(service.getValidContext(channel.id)).rejects.toMatchObject({
        code: 'CHANNEL_DISCONNECTED',
      });
      expect(await t.db.select().from(notifications)).toHaveLength(0);
    });

    it('answers 404 for an unknown channel', async () => {
      await expect(
        t.app.get(TokenService).getValidContext('01900000-0000-7000-8000-000000000000'),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
