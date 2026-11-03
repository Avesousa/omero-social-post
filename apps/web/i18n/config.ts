// Locale settings shared by the server request config, the locale action and the UI switch.
// URLs carry no locale prefix: the active locale lives in a cookie and falls back to Spanish.

export const locales = ['es', 'en'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'es';

/** Same cookie name next-intl's middleware uses, so a later routing setup stays compatible. */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** One year, in seconds. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}
