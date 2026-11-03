import { PROVIDER_LIMITS } from '@omero/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { OAuthStateStore } from '../../src/providers/oauth-state.store';
import { ProviderRegistry } from '../../src/providers/provider.registry';
import { createTestApp, type TestApp } from '../helpers/app';
import { loginAs } from '../helpers/auth';
import { resetDb } from '../helpers/db';

describe('GET /providers', () => {
  let t: TestApp | undefined;

  afterEach(async () => {
    await t?.close();
    t = undefined;
  });

  it('reports configured: false with the missing env vars when credentials are absent', async () => {
    t = await createTestApp({
      env: {
        WORKERS_ENABLED: 'false',
        X_CLIENT_ID: undefined,
        X_CLIENT_SECRET: undefined,
        LINKEDIN_CLIENT_ID: undefined,
        LINKEDIN_CLIENT_SECRET: undefined,
      },
    });
    await resetDb(t.db);
    const res = await (await loginAs(t)).http.get('/api/v1/providers').expect(200);
    expect(res.body).toEqual([
      {
        id: 'x',
        configured: false,
        missingEnv: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
        limits: PROVIDER_LIMITS.x,
      },
      {
        id: 'linkedin',
        configured: false,
        missingEnv: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
        limits: PROVIDER_LIMITS.linkedin,
      },
    ]);
    expect(t.app.get(ProviderRegistry).find('x')).toBeUndefined();
    expect(() => t!.app.get(ProviderRegistry).get('x')).toThrow(/X_CLIENT_ID/);
  });

  it('reports configured: true only for providers with credentials', async () => {
    t = await createTestApp({
      env: { WORKERS_ENABLED: 'false', X_CLIENT_ID: 'id', X_CLIENT_SECRET: 'secret' },
    });
    await resetDb(t.db);
    const res = await (await loginAs(t)).http.get('/api/v1/providers').expect(200);
    const byId = Object.fromEntries(
      (res.body as Array<{ id: string; configured: boolean }>).map((p) => [p.id, p.configured]),
    );
    expect(byId).toEqual({ x: true, linkedin: false });

    const registry = t.app.get(ProviderRegistry);
    expect(registry.redirectUri('x')).toBe('http://localhost:3000/api/v1/channels/x/callback');
    const url = registry.get('x').getAuthorizationUrl('s', {
      codeVerifier: 'v',
      codeChallenge: 'c',
      codeChallengeMethod: 'S256',
    });
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/v1/channels/x/callback',
    );
    // The state store is exported for the channels module.
    expect(t.app.get(OAuthStateStore)).toBeInstanceOf(OAuthStateStore);
  });
});
