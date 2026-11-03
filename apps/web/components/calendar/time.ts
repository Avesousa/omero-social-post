import { DateTime } from 'luxon';

/**
 * Timezone helpers. FullCalendar (with the luxon plugin) hands back wall-clock strings in the
 * owner's timezone, without an offset; these convert them to the UTC instants the API stores.
 */

/** Wall-clock ISO string in `zone` (e.g. "2026-11-05T10:30:00") to a UTC ISO instant. */
export function wallClockToUtc(wallClock: string, zone: string): string {
  const dt = DateTime.fromISO(wallClock, { zone });
  return dt.toUTC().toISO({ suppressMilliseconds: true }) ?? wallClock;
}

/** Date-only clicks (month view) get a default time of day. */
export function withDefaultTime(wallClock: string, hour = 9): string {
  return wallClock.includes('T')
    ? wallClock
    : `${wallClock}T${String(hour).padStart(2, '0')}:00:00`;
}

export function isValidZone(zone: string | undefined): zone is string {
  return !!zone && DateTime.now().setZone(zone).isValid;
}

/** "14:30" in the owner's zone for a UTC instant. */
export function formatTime(iso: string, zone: string, locale: string): string {
  return DateTime.fromISO(iso, { zone }).setLocale(locale).toFormat('HH:mm');
}
