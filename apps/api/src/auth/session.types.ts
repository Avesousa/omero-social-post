/**
 * What the global session guard attaches to every authenticated request as `req.session`.
 * `sessionId` is the stored sha256 of the cookie token (safe to use as a key, e.g. to bind
 * OAuth state to the session); the raw token is never exposed.
 */
export interface AuthSession {
  sessionId: string;
  userId: string;
}

declare global {
  // Express merges its Request type with this global namespace (same pattern as passport).
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by SessionGuard / SessionAuthMiddleware; undefined on public routes. */
      session?: AuthSession;
    }
  }
}
