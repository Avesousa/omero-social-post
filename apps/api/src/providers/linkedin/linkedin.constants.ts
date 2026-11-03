/** REST host (`/v2/userinfo`, `/rest/posts`, `/rest/images`). */
export const LINKEDIN_API_BASE = 'https://api.linkedin.com';
/** OAuth host (`/oauth/v2/authorization`, `/oauth/v2/accessToken`); also serves image upload URLs. */
export const LINKEDIN_WWW_BASE = 'https://www.linkedin.com';
export const LINKEDIN_AUTHORIZE_URL = `${LINKEDIN_WWW_BASE}/oauth/v2/authorization`;
export const LINKEDIN_TOKEN_URL = `${LINKEDIN_WWW_BASE}/oauth/v2/accessToken`;

/**
 * Versioned REST API (`Linkedin-Version: YYYYMM`). LinkedIn supports each version for
 * about a year (202511 sunsets on 2026-11-16). Bump this when moving to a newer version
 * and re-check the Posts and Images API pages for that version.
 */
export const LINKEDIN_API_VERSION = '202610';
export const LINKEDIN_RESTLI_PROTOCOL_VERSION = '2.0.0';

/** Sign In with LinkedIn using OpenID Connect + Share on LinkedIn (both self-serve products). */
export const LINKEDIN_SCOPES = ['openid', 'profile', 'w_member_social'] as const;

/** `content.multiImage.images` accepts 2 to 20 images. */
export const LINKEDIN_MULTI_IMAGE_MIN = 2;
