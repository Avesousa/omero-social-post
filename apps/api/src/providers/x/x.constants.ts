/** X API v2 host (posts, users, media upload, OAuth token endpoint). */
export const X_API_BASE = 'https://api.x.com';
/** Consent screen. */
export const X_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
export const X_TOKEN_URL = `${X_API_BASE}/2/oauth2/token`;

/**
 * `offline.access` yields a refresh token; `media.write` is required by the v2 media
 * upload endpoint; `users.read` + `tweet.read` are required by GET /2/users/me and
 * (together with `tweet.write`) by POST /2/tweets.
 */
export const X_SCOPES = [
  'tweet.read',
  'tweet.write',
  'users.read',
  'media.write',
  'offline.access',
] as const;

/** GET /2/tweets accepts at most 100 ids per request. */
export const X_MAX_IDS_PER_LOOKUP = 100;

/**
 * Field-selection parameter name for posts. The current OpenAPI spec calls it
 * `post.fields`, but every guide and the changelog still use `tweet.fields`;
 * kept as a constant in case X drops the old name.
 */
export const X_POST_FIELDS_PARAM = 'tweet.fields';
