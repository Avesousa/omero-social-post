import { NextResponse, type NextRequest } from 'next/server';

/** Name of the session cookie set by the API (`SESSION_COOKIE` in apps/api). */
const SESSION_COOKIE = 'omero_session';

/** Internal address of the API, same default as `next.config.ts`. Read at runtime. */
const apiInternalUrl = () =>
  (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');

const AUTH_PAGES = new Set(['/login', '/setup']);

async function fetchJson<T>(path: string, cookie?: string): Promise<T | null> {
  try {
    const response = await fetch(`${apiInternalUrl()}/api/v1${path}`, {
      headers: cookie ? { cookie } : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    // API unreachable: do not block navigation, the pages show their own error states.
    return null;
  }
}

/**
 * Route guard (Next 16 `proxy`, the successor of `middleware`).
 *
 * - Everything except `/login`, `/setup`, static assets and `/api` requires the session cookie;
 *   without it the visitor is sent to `/login`. The cookie is only checked for presence here:
 *   the API validates it, and a stale cookie ends in a 401 that the client turns into a redirect.
 * - `/login` goes to `/setup` while no owner exists; `/setup` goes to `/login` once one does.
 * - `/login` and `/setup` go to `/calendar` when the session is already valid.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);

  if (!AUTH_PAGES.has(pathname)) {
    if (hasSession) return NextResponse.next();
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (hasSession) {
    const me = await fetchJson<{ id: string }>('/auth/me', request.headers.get('cookie') ?? '');
    if (me) return NextResponse.redirect(new URL('/calendar', request.url));
  }

  const status = await fetchJson<{ needsSetup: boolean }>('/auth/setup-status');
  if (status) {
    if (pathname === '/login' && status.needsSetup) {
      return NextResponse.redirect(new URL('/setup', request.url));
    }
    if (pathname === '/setup' && !status.needsSetup) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }
  return NextResponse.next();
}

export const config = {
  // Skip the API rewrite, Next internals and anything that looks like a file (has an extension).
  matcher: ['/((?!api/|_next/|.*\\..*).*)'],
};
