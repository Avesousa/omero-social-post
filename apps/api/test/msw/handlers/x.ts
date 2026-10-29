import { type HttpHandler } from 'msw';

/** X API v2 base URL (posts, users, media upload, OAuth token endpoint). */
export const X_API_BASE = 'https://api.x.com';

/**
 * Default X handlers, active in every test. Keep this empty or happy-path only;
 * tests override per case with `server.use(http.post(`${X_API_BASE}/2/tweets`, ...))`.
 */
export const xHandlers: HttpHandler[] = [];
