import { type UnhandledFrameHandle } from 'msw';
import { setupServer } from 'msw/node';
import { linkedinHandlers } from './handlers/linkedin';
import { xHandlers } from './handlers/x';

/**
 * Process-wide msw server (started by test/setup/msw.ts). Add per-test handlers with
 * `server.use(...)`; they are reset after each test.
 */
export const server = setupServer(...xHandlers, ...linkedinHandlers);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

function isLocal(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Local traffic (supertest against the app) passes through untouched. Any request to
 * an external host (X, LinkedIn, Telegram, anything else) without a matching handler
 * fails the request, so tests can never reach the real networks by accident.
 * (msw 3 renamed `onUnhandledRequest` to `onUnhandledFrame`.)
 */
export const onUnhandledFrame: UnhandledFrameHandle = ({ frame, defaults }) => {
  const data = frame.data as { request?: Request; url?: URL | string } | undefined;
  const url = data?.request?.url ?? (data?.url ? String(data.url) : '');
  if (isLocal(url)) return;
  defaults.error();
};
