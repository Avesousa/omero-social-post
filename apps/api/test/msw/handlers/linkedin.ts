import { type HttpHandler } from 'msw';

/** LinkedIn REST API (`/v2/userinfo`, `/rest/posts`, `/rest/images`). */
export const LINKEDIN_API_BASE = 'https://api.linkedin.com';
/** LinkedIn OAuth endpoints (`/oauth/v2/accessToken`). */
export const LINKEDIN_OAUTH_BASE = 'https://www.linkedin.com';

/** Default LinkedIn handlers, active in every test. Override per test with `server.use`. */
export const linkedinHandlers: HttpHandler[] = [];
