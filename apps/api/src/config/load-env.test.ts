import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from './load-env';

const valid = {
  PUBLIC_BASE_URL: 'https://omero.example.ts.net/',
  DATABASE_URL: 'postgres://omero:omero@127.0.0.1:5432/omero',
  REDIS_URL: 'redis://127.0.0.1:6379/0',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

function expectEnvError(env: Record<string, string>): EnvValidationError {
  try {
    loadEnv(env);
  } catch (err) {
    expect(err).toBeInstanceOf(EnvValidationError);
    return err as EnvValidationError;
  }
  throw new Error('expected loadEnv to throw');
}

describe('loadEnv', () => {
  it('applies defaults and normalizes values', () => {
    const env = loadEnv(valid);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      HOST: '0.0.0.0',
      LOG_LEVEL: 'info',
      MEDIA_DIR: './media-data',
      WORKERS_ENABLED: true,
      PUBLIC_BASE_URL: 'https://omero.example.ts.net',
    });
    expect(env.X_CLIENT_ID).toBeUndefined();
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('fails fast with a readable message when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = valid;
    const err = expectEnvError(rest);
    expect(err.message).toContain('Invalid environment configuration');
    expect(err.message).toContain('DATABASE_URL: is required but not set');
  });

  it('treats empty strings as unset', () => {
    const err = expectEnvError({ ...valid, REDIS_URL: '' });
    expect(err.issues).toEqual([{ variable: 'REDIS_URL', problem: 'is required but not set' }]);
  });

  it('rejects malformed values without echoing them', () => {
    const err = expectEnvError({
      ...valid,
      ENCRYPTION_KEY: 'not-a-real-key-but-maybe-a-secret',
      DATABASE_URL: 'mysql://root@localhost/db',
      PORT: 'abc',
    });
    const vars = err.issues.map((i) => i.variable).sort();
    expect(vars).toEqual(['DATABASE_URL', 'ENCRYPTION_KEY', 'PORT']);
    expect(err.message).toContain('openssl rand -base64 32');
    expect(err.message).not.toContain('not-a-real-key-but-maybe-a-secret');
  });

  it('rejects encryption keys of the wrong length', () => {
    const err = expectEnvError({ ...valid, ENCRYPTION_KEY: randomBytes(16).toString('base64') });
    expect(err.issues[0]?.variable).toBe('ENCRYPTION_KEY');
  });

  it.each([
    ['false', false],
    ['0', false],
    ['no', false],
    ['true', true],
    ['1', true],
  ])('parses WORKERS_ENABLED=%s', (raw, expected) => {
    expect(loadEnv({ ...valid, WORKERS_ENABLED: raw }).WORKERS_ENABLED).toBe(expected);
  });

  it('requires optional integrations as complete pairs', () => {
    const err = expectEnvError({ ...valid, X_CLIENT_ID: 'abc' });
    expect(err.issues).toEqual([
      { variable: 'X_CLIENT_SECRET', problem: 'must be set together with X_CLIENT_ID' },
    ]);
    expect(
      loadEnv({ ...valid, TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' }).TELEGRAM_CHAT_ID,
    ).toBe('1');
  });
});
