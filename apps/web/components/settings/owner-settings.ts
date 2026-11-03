'use client';

import { useSettingsControllerGet } from '@omero/api-client';

/** Time zone of the browser, or UTC when the runtime cannot tell. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Formats an instant in a given zone, e.g. "viernes, 1 de noviembre, 09:00". */
export function formatInstant(
  iso: string,
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(new Date(iso));
}

/**
 * The owner's saved settings. `timezone` falls back to the browser's zone until the request
 * answers, so dates never render in a surprising zone for a flash.
 */
export function useOwnerSettings() {
  const query = useSettingsControllerGet();
  return {
    settings: query.data,
    timezone: query.data?.timezone ?? browserTimeZone(),
    isPending: query.isPending,
    isError: query.isError,
    refetch: query.refetch,
  };
}
