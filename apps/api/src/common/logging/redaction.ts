export const REDACTED = '[REDACTED]';

/** Exact paths pino redacts (fast-redact syntax). Header names are lower-case in Node. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
];

/** Any field whose name contains one of these words is redacted, at any depth. */
const SENSITIVE_KEY = /token|password|passwd|secret|authorization|cookie|api[-_]?key/i;

/** Query parameters that may carry credentials (OAuth `code`/`state`, tokens). */
const SENSITIVE_QUERY_PARAM = /^(code|state|code_verifier)$|token|password|secret/i;

const MAX_DEPTH = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Returns a copy of a log payload with sensitive-looking keys replaced by `[REDACTED]`.
 * Only plain objects and arrays are walked: class instances (raw `req`/`res`, errors,
 * Dates) are left to their pino serializers, and the input is never mutated.
 */
export function redactSensitiveKeys<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveKeys(item, depth + 1)) as T;
  }
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] =
      SENSITIVE_KEY.test(key) && inner !== undefined && inner !== null
        ? REDACTED
        : redactSensitiveKeys(inner, depth + 1);
  }
  return out as T;
}

/** Masks the values of credential-like query parameters in a request URL. */
export function redactUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;
  const params = new URLSearchParams(url.slice(queryStart + 1));
  for (const key of [...params.keys()]) {
    if (SENSITIVE_QUERY_PARAM.test(key)) params.set(key, REDACTED);
  }
  return `${url.slice(0, queryStart)}?${params.toString()}`;
}
