/** Name of the HttpOnly cookie carrying the raw session token. */
export const SESSION_COOKIE = 'omero_session';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Sliding session lifetime: every renewal pushes `expires_at` to now + 30 days. */
export const SESSION_TTL_MS = 30 * DAY_MS;

/**
 * A session's `expires_at` / `last_seen_at` are refreshed at most once per hour, so an
 * active owner does not cause a database write on every request.
 */
export const SESSION_RENEW_INTERVAL_MS = HOUR_MS;

/** Login brute-force protection: attempts per window, per client IP + username. */
export const LOGIN_THROTTLE = {
  name: 'login',
  limit: 5,
  ttlMs: 15 * 60_000,
} as const;

/** Redis key prefix for throttler counters (kept under the app's `omero:` namespace). */
export const THROTTLE_KEY_PREFIX = 'omero:throttle:';

/** Password policy from the technical spec (argon2id, minimum 12 characters). */
export const PASSWORD_MIN_LENGTH = 12;
/** Upper bound so a huge body cannot make hashing expensive. */
export const PASSWORD_MAX_LENGTH = 1024;
