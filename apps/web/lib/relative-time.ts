import { useSyncExternalStore } from 'react';

const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "hace 5 min", "ayer", "in 2 hours": `iso` relative to `now` (epoch ms), in the given locale. */
export function formatRelativeTime(iso: string, now: number, locale: string): string {
  const diffSeconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(diffSeconds);
  for (const [unit, seconds] of UNITS) {
    if (abs >= seconds) return formatter.format(Math.round(diffSeconds / seconds), unit);
  }
  return formatter.format(0, 'second');
}

// One shared ticker: every consumer reads the same cached value, refreshed every 30 s.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let current = 0;

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((notify) => notify());
    }, 30_000);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const getSnapshot = () => current;
const getServerSnapshot = () => 0;

/**
 * Current time in epoch ms, refreshed every 30 s, so relative labels stay fresh without
 * re-fetching. It is 0 until the first subscription (and on the server): render labels only
 * from data that exists after hydration.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
