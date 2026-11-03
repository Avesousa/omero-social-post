import { createHash, randomBytes } from 'node:crypto';

/** 256-bit random token, base64url (43 chars). Only ever stored in the cookie. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** `sessions.id` is the sha256 (hex) of the raw token, so a database leak yields no usable cookie. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Cheap shape check before touching the database with an attacker-controlled value. */
export function isWellFormedSessionToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}
