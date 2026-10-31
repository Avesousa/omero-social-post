import { isApiError } from '@omero/api-client';
import { isServer, MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

/** Pages that are reachable without a session; a 401 there is a normal answer, not a logout. */
const PUBLIC_PATHS = ['/login', '/setup'];

/**
 * Sends the visitor to the login page when an authenticated request is rejected with 401
 * (expired or revoked session). A hard navigation also drops every cached query.
 */
function redirectToLoginOnUnauthorized(error: unknown) {
  if (isServer || !isApiError(error) || error.status !== 401) return;
  if (PUBLIC_PATHS.includes(window.location.pathname)) return;
  // Intentional hard navigation: this runs outside React (no router), and a full load drops
  // every cached query of the expired session.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = '/login';
}

function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: redirectToLoginOnUnauthorized }),
    mutationCache: new MutationCache({ onError: redirectToLoginOnUnauthorized }),
    defaultOptions: {
      queries: {
        // Avoid an immediate refetch right after hydration.
        staleTime: 30_000,
        retry: (failureCount, error) => {
          // Auth and validation answers are final; only retry transient failures once.
          if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
          return failureCount < 1;
        },
        refetchOnWindowFocus: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * Returns a fresh client per request on the server and a singleton in the browser,
 * so cached data is never shared between requests.
 */
export function getQueryClient() {
  if (isServer) {
    return makeQueryClient();
  }
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
