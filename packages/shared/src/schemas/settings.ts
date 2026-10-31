import { z } from 'zod';

export const DEFAULT_MISSED_GRACE_MINUTES = 360;
/** Upper bound for the missed-post grace window (7 days). */
export const MAX_MISSED_GRACE_MINUTES = 7 * 24 * 60;

/** True when `tz` is an IANA time zone the runtime understands. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z.string().min(1).refine(isValidTimeZone, {
  message: 'must be a valid IANA time zone',
});

/** Body and response of `GET/PUT /settings`. */
export const settingsSchema = z.object({
  timezone: timezoneSchema,
  missedGraceMinutes: z
    .int()
    .min(0)
    .max(MAX_MISSED_GRACE_MINUTES)
    .default(DEFAULT_MISSED_GRACE_MINUTES),
});
export type Settings = z.infer<typeof settingsSchema>;

/** 24-hour "HH:mm" local time. */
export const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'must be a 24-hour time in HH:mm format' });

/** One weekly queue slot. `weekday` follows JS `Date#getDay()`: 0 = Sunday … 6 = Saturday. */
export const queueSlotSchema = z.object({
  weekday: z.int().min(0).max(6),
  localTime: localTimeSchema,
  enabled: z.boolean().default(true),
});
export type QueueSlot = z.infer<typeof queueSlotSchema>;

/** Body of `PUT /queue-slots`: the whole weekly set, without duplicates. */
export const queueSlotsSchema = z
  .array(queueSlotSchema)
  .max(7 * 48)
  .refine(
    (slots) => new Set(slots.map((s) => `${s.weekday}-${s.localTime}`)).size === slots.length,
    {
      message: 'duplicate queue slot (same weekday and time)',
    },
  );
export type QueueSlots = z.infer<typeof queueSlotsSchema>;
