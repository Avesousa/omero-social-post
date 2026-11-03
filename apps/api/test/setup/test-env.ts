import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inject } from 'vitest';
import { type Env } from '../../src/config/env.schema';
import { loadEnv } from '../../src/config/load-env';
import { TokenCipher } from '../../src/crypto/token-cipher.service';
import { type TestInfra } from './infra';

/** Random per test file; never a real secret. */
export const TEST_ENCRYPTION_KEY = randomBytes(32).toString('base64');

let mediaDir: string | undefined;

export function testInfra(): TestInfra {
  return inject('testInfra');
}

/**
 * The validated env used by test apps. Override any variable per test, e.g.
 * `testEnv({ WORKERS_ENABLED: 'false' })`. Set TEST_LOG_LEVEL=debug to see app logs.
 */
export function testEnv(overrides: Record<string, string | undefined> = {}): Env {
  const infra = testInfra();
  mediaDir ??= mkdtempSync(join(tmpdir(), 'omero-media-'));
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    PUBLIC_BASE_URL: 'http://localhost:3000',
    DATABASE_URL: infra.databaseUrl,
    REDIS_URL: infra.redisUrl,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    MEDIA_DIR: mediaDir,
    WORKERS_ENABLED: 'true',
    ...overrides,
  });
}

/** Cipher bound to {@link TEST_ENCRYPTION_KEY}, same as the test app's TokenCipherService. */
export function testCipher(): TokenCipher {
  return new TokenCipher({ v1: TEST_ENCRYPTION_KEY });
}
