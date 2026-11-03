'use server';

import { cookies } from 'next/headers';
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from './config';

/** Persists the UI locale in a first-party cookie. The caller refreshes the route afterwards. */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: false,
  });
}
