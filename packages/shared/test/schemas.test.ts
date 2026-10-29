import { describe, expect, it } from 'vitest';
import {
  CHANNEL_STATUSES,
  DELIVERY_ITEM_STATUSES,
  DELIVERY_STATUSES,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  METRICS_CHECKPOINTS,
  NOTIFICATION_TYPES,
  POST_STATUSES,
  postInputSchema,
  problemDetailsSchema,
  PROVIDER_IDS,
  PROVIDER_LIMITS,
  providerLimitsSchema,
  publishNowSchema,
  queuePostSchema,
  queueSlotSchema,
  queueSlotsSchema,
  SCHEDULED_VIA,
  schedulePostSchema,
  settingsSchema,
} from '../src';

const ID = '0192f3a0-0000-7000-8000-000000000001';

describe('canonical enum values', () => {
  it('match the technical spec exactly', () => {
    expect(PROVIDER_IDS).toEqual(['x', 'linkedin']);
    expect(POST_STATUSES).toEqual([
      'draft',
      'scheduled',
      'publishing',
      'published',
      'partially_published',
      'failed',
      'missed',
    ]);
    expect(DELIVERY_STATUSES).toEqual(['pending', 'publishing', 'published', 'failed', 'missed']);
    expect(DELIVERY_ITEM_STATUSES).toEqual(['pending', 'published', 'failed']);
    expect(CHANNEL_STATUSES).toEqual(['connected', 'needs_reconnect', 'disconnected']);
    expect(SCHEDULED_VIA).toEqual(['manual', 'queue', 'now']);
    expect(METRICS_CHECKPOINTS).toEqual(['1h', '24h', '7d', 'manual']);
    expect(NOTIFICATION_TYPES).toEqual([
      'delivery_failed',
      'channel_reauth',
      'token_expiring',
      'post_missed',
    ]);
    expect(ERROR_CODES).toEqual([
      'NO_FREE_SLOT',
      'VERSION_CONFLICT',
      'VALIDATION_FAILED',
      'SETUP_ALREADY_DONE',
      'INVALID_CREDENTIALS',
      'CHANNEL_NOT_CONFIGURED',
      'REAUTH_REQUIRED',
      'NOT_FOUND',
      'FORBIDDEN_STATE',
    ]);
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });
});

describe('provider limits', () => {
  it('are valid against their own schema', () => {
    for (const id of PROVIDER_IDS)
      expect(providerLimitsSchema.parse(PROVIDER_LIMITS[id])).toEqual(PROVIDER_LIMITS[id]);
  });

  it('describe X and LinkedIn', () => {
    expect(PROVIDER_LIMITS.x).toMatchObject({
      maxChars: 280,
      weightedCounting: true,
      maxImagesPerItem: 4,
    });
    expect(PROVIDER_LIMITS.x.supportsThreads).toBe(true);
    expect(PROVIDER_LIMITS.linkedin).toMatchObject({
      maxChars: 3000,
      weightedCounting: false,
      maxImagesPerItem: 9,
    });
    expect(PROVIDER_LIMITS.linkedin.supportsThreads).toBe(false);
  });
});

describe('postInputSchema', () => {
  it('fills default media arrays', () => {
    const parsed = postInputSchema.parse({
      baseContent: 'hi',
      channels: [{ channelId: ID, customized: true, items: [{ text: 'x' }] }],
    });
    expect(parsed.baseMediaIds).toEqual([]);
    expect(parsed.channels[0]?.items?.[0]?.mediaIds).toEqual([]);
  });

  it('requires items when a channel is customized', () => {
    const result = postInputSchema.safeParse({
      baseContent: 'hi',
      channels: [{ channelId: ID, customized: true }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['channels', 0, 'items']);
  });

  it('rejects non-uuid ids', () => {
    expect(
      postInputSchema.safeParse({
        baseContent: 'hi',
        channels: [{ channelId: 'nope', customized: false }],
      }).success,
    ).toBe(false);
  });
});

describe('scheduling payloads', () => {
  it('accept ISO timestamps with a version', () => {
    expect(schedulePostSchema.parse({ at: '2026-11-02T12:00:00Z', version: 3 })).toEqual({
      at: '2026-11-02T12:00:00Z',
      version: 3,
    });
    expect(
      schedulePostSchema.safeParse({ at: '2026-11-02T09:00:00-03:00', version: 0 }).success,
    ).toBe(true);
  });

  it('reject invalid timestamps and versions', () => {
    expect(schedulePostSchema.safeParse({ at: 'tomorrow', version: 1 }).success).toBe(false);
    expect(schedulePostSchema.safeParse({ at: '2026-11-02T12:00:00Z' }).success).toBe(false);
    expect(queuePostSchema.safeParse({ version: -1 }).success).toBe(false);
    expect(publishNowSchema.safeParse({ version: 1.5 }).success).toBe(false);
    expect(publishNowSchema.parse({ version: 2 })).toEqual({ version: 2 });
  });
});

describe('settingsSchema', () => {
  it('validates the time zone and defaults the grace window to 360', () => {
    expect(settingsSchema.parse({ timezone: 'America/Argentina/Buenos_Aires' })).toEqual({
      timezone: 'America/Argentina/Buenos_Aires',
      missedGraceMinutes: 360,
    });
    expect(settingsSchema.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(settingsSchema.safeParse({ timezone: 'UTC', missedGraceMinutes: -1 }).success).toBe(
      false,
    );
  });
});

describe('queue slots', () => {
  it('accept weekday 0-6 and HH:mm', () => {
    expect(queueSlotSchema.parse({ weekday: 1, localTime: '09:00' })).toEqual({
      weekday: 1,
      localTime: '09:00',
      enabled: true,
    });
    expect(queueSlotSchema.safeParse({ weekday: 7, localTime: '09:00' }).success).toBe(false);
    expect(queueSlotSchema.safeParse({ weekday: 0, localTime: '24:00' }).success).toBe(false);
    expect(queueSlotSchema.safeParse({ weekday: 0, localTime: '9:00' }).success).toBe(false);
  });

  it('reject duplicates in the weekly set', () => {
    const slot = { weekday: 1, localTime: '09:00', enabled: true };
    expect(queueSlotsSchema.safeParse([slot, { ...slot, localTime: '18:00' }]).success).toBe(true);
    expect(queueSlotsSchema.safeParse([slot, slot]).success).toBe(false);
  });
});

describe('problemDetailsSchema', () => {
  it('parses an RFC 9457 body with field errors', () => {
    const body = problemDetailsSchema.parse({
      title: 'Validation failed',
      status: 422,
      code: 'VALIDATION_FAILED',
      errors: [
        {
          path: 'channels.0.items.1.text',
          code: 'TEXT_TOO_LONG',
          message: 'too long',
          params: { limit: 280 },
        },
      ],
    });
    expect(body.type).toBe('about:blank');
    expect(body.errors?.[0]?.path).toBe('channels.0.items.1.text');
  });

  it('rejects unknown error codes', () => {
    expect(problemDetailsSchema.safeParse({ title: 'x', status: 400, code: 'NOPE' }).success).toBe(
      false,
    );
  });
});
