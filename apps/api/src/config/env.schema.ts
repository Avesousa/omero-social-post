import { z } from 'zod';

/** Accepts the usual spellings of a boolean flag in env files. */
const booleanFlag = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'], {
    error: 'must be one of true/false/1/0/yes/no',
  })
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

const ENCRYPTION_KEY_BYTES = 32;

/** Validates that a value is standard base64 that decodes to exactly 32 bytes. */
function isBase64Key(value: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === ENCRYPTION_KEY_BYTES && decoded.toString('base64') === value;
}

const optionalString = z.string().trim().min(1).optional();

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    /** Interface to bind. 0.0.0.0 inside containers; 127.0.0.1 for a local dev box. */
    HOST: z.string().trim().min(1).default('0.0.0.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    /** Public origin of the web app, e.g. https://omero.tailnet-123.ts.net (no trailing slash). */
    PUBLIC_BASE_URL: z
      .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
      .transform((value) => value.replace(/\/+$/, '')),

    DATABASE_URL: z.url({
      protocol: /^postgres(ql)?$/,
      error: 'must be a postgres:// connection URL',
    }),
    REDIS_URL: z.url({ protocol: /^rediss?$/, error: 'must be a redis:// connection URL' }),

    /** 32 random bytes, base64. Generate with `openssl rand -base64 32`. */
    ENCRYPTION_KEY: z.string().refine(isBase64Key, {
      error: 'must be 32 bytes encoded as base64 (generate one with `openssl rand -base64 32`)',
    }),

    MEDIA_DIR: z.string().trim().min(1).default('./media-data'),
    /** Run BullMQ processors in this process. Set to false to run an HTTP-only instance. */
    WORKERS_ENABLED: booleanFlag.default(true),

    X_CLIENT_ID: optionalString,
    X_CLIENT_SECRET: optionalString,
    LINKEDIN_CLIENT_ID: optionalString,
    LINKEDIN_CLIENT_SECRET: optionalString,
    TELEGRAM_BOT_TOKEN: optionalString,
    TELEGRAM_CHAT_ID: optionalString,
  })
  .superRefine((env, ctx) => {
    // Optional integrations must be configured as complete pairs.
    const pairs: Array<[keyof typeof env, keyof typeof env]> = [
      ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
      ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
      ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
    ];
    for (const [a, b] of pairs) {
      if (Boolean(env[a]) !== Boolean(env[b])) {
        const missing = env[a] ? b : a;
        ctx.addIssue({
          code: 'custom',
          path: [missing],
          message: `must be set together with ${missing === a ? b : a}`,
        });
      }
    }
  });

export type Env = z.output<typeof envSchema>;
