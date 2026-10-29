import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Internal address of the NestJS API. The browser never talks to it directly:
 * every `/api/*` request goes to the web origin and is rewritten here, so the
 * session cookie stays first-party and no CORS setup is needed.
 *
 * Note: rewrites are resolved when `next build` runs, so with `output: 'standalone'`
 * this value must be present at build time (for example as a Docker build arg).
 */
const apiInternalUrl = (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000').replace(
  /\/+$/,
  '',
);

/** Avatar CDNs used by the connected networks (X and LinkedIn profile pictures). */
const avatarHosts = ['https://pbs.twimg.com', 'https://media.licdn.com'];

/**
 * Content Security Policy.
 *
 * Next.js App Router injects inline bootstrap scripts, and next-themes injects a
 * tiny inline script to avoid a theme flash, so `script-src` needs 'unsafe-inline'
 * unless we move to per-request nonces (which would force dynamic rendering).
 * The app is single-user and private behind Tailscale, so this trade-off is accepted
 * for the MVP. Dev mode additionally needs 'unsafe-eval' and websockets for HMR.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' blob: data: ${avatarHosts.join(' ')}`,
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    remotePatterns: avatarHosts.map((host) => new URL(`${host}/**`)),
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
