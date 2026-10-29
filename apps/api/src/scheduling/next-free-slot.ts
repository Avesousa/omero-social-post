import { formatInTimeZone } from 'date-fns-tz';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Default look-ahead for "Add to queue" (functional spec, Flow 4). */
export const QUEUE_HORIZON_DAYS = 30;

/** A weekly slot as the scheduler sees it. Same shape as `QueueSlot` in `@omero/shared`. */
export interface WeeklySlot {
  /** 0 = Sunday ... 6 = Saturday (JS `Date#getDay`), in the owner's timezone. */
  weekday: number;
  /** Wall-clock "HH:mm" (a trailing ":ss" is tolerated and ignored). */
  localTime: string;
  enabled: boolean;
}

export interface NextFreeSlotInput {
  now: Date;
  /** IANA time zone the slots are defined in, e.g. `America/Argentina/Buenos_Aires`. */
  timezone: string;
  slots: readonly WeeklySlot[];
  /** Instants already used by scheduled/publishing posts; compared at minute precision. */
  takenTimes: readonly Date[];
  horizonDays?: number;
}

/**
 * Returns the earliest enabled weekly slot strictly after `now`, within `horizonDays`,
 * whose minute is not already taken, as a UTC `Date`; or `null` when there is none
 * (the caller maps that to `NO_FREE_SLOT`).
 *
 * Slots are wall-clock times in `timezone`, so a 09:00 slot stays at 09:00 local time
 * across DST changes. A local time that does not exist (spring-forward gap) resolves
 * to the first valid instant after the gap; an ambiguous one (fall-back) resolves to
 * its first occurrence.
 */
export function nextFreeSlot({
  now,
  timezone,
  slots,
  takenTimes,
  horizonDays = QUEUE_HORIZON_DAYS,
}: NextFreeSlotInput): Date | null {
  const enabled = slots.filter((s) => s.enabled).map((s) => ({ ...s, ...parseLocalTime(s) }));
  if (enabled.length === 0) return null;

  const nowMs = now.getTime();
  const limitMs = nowMs + horizonDays * DAY_MS;
  const taken = new Set(takenTimes.map((t) => Math.floor(t.getTime() / MINUTE_MS)));

  // The owner's calendar date "today"; local dates are then walked with plain UTC
  // arithmetic (a calendar date has no timezone), and only slot times are resolved.
  const [year, month, day] = formatInTimeZone(now, timezone, 'yyyy-MM-dd').split('-').map(Number);

  for (let offsetDays = 0; offsetDays <= horizonDays + 1; offsetDays++) {
    const date = new Date(Date.UTC(year!, month! - 1, day! + offsetDays));
    const weekday = date.getUTCDay();
    const candidates = enabled
      .filter((s) => s.weekday === weekday)
      .map((s) =>
        zonedWallTimeToUtc(
          Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), s.hour, s.minute),
          timezone,
        ),
      )
      .sort((a, b) => a - b);

    for (const utcMs of candidates) {
      if (utcMs > limitMs) return null;
      if (utcMs <= nowMs) continue;
      if (taken.has(Math.floor(utcMs / MINUTE_MS))) continue;
      return new Date(utcMs);
    }
  }
  return null;
}

function parseLocalTime(slot: WeeklySlot): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(slot.localTime);
  if (!match) throw new RangeError(`Invalid slot time "${slot.localTime}"`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * UTC offset (ms, local = utc + offset) in force at an instant. Derived from formatting
 * the instant, because date-fns-tz `getTimezoneOffset` reads the Date's fields in the
 * process time zone and so depends on `TZ`.
 */
function offsetAt(timezone: string, utcMs: number): number {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(formatInTimeZone(utcMs, timezone, 'xxx'));
  if (!match) throw new RangeError(`Invalid time zone "${timezone}"`);
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return (match[1] === '-' ? -minutes : minutes) * MINUTE_MS;
}

/**
 * Converts a wall-clock time (encoded as if it were UTC, `wallMs`) in `timezone` to the
 * real UTC instant, with explicit DST rules. (date-fns-tz `fromZonedTime` resolves a
 * spring-forward gap backwards, so it is not used here.)
 */
export function zonedWallTimeToUtc(wallMs: number, timezone: string): number {
  // The offsets in force around this wall time; they differ only near a transition.
  const offsetBefore = offsetAt(timezone, wallMs - DAY_MS);
  const offsetAfter = offsetAt(timezone, wallMs + DAY_MS);

  const valid = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => wallMs - offset)
    .filter((utcMs) => offsetAt(timezone, utcMs) === wallMs - utcMs)
    .sort((a, b) => a - b);
  // One match: a normal time. Two: ambiguous (fall back), take the first occurrence.
  if (valid.length > 0) return valid[0]!;

  // No match: the wall time falls in a spring-forward gap. The transition instant lies
  // between these two bounds; binary-search it at minute precision (all modern
  // transitions are on whole minutes). That instant is the first valid one after the gap.
  let lo = Math.floor((wallMs - offsetAfter) / MINUTE_MS);
  let hi = Math.ceil((wallMs - offsetBefore) / MINUTE_MS);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetAt(timezone, mid * MINUTE_MS) === offsetAfter) hi = mid;
    else lo = mid + 1;
  }
  return hi * MINUTE_MS;
}
