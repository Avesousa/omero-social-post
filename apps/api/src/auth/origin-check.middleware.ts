import { HttpStatus } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ErrorCode } from '../common/errors/error-codes';
import { ProblemException } from '../common/errors/problem.exception';
import { sendProblem } from '../common/errors/send-problem';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function originOf(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

/**
 * True when a mutating request provably comes from the app's own origin: `Origin` must
 * equal PUBLIC_BASE_URL's origin, or, when `Origin` is absent, the `Referer`'s origin
 * must. Requests with neither header are rejected. Safe methods always pass.
 */
export function isSameOriginRequest(
  method: string,
  headers: { origin?: string; referer?: string },
  expectedOrigin: string,
): boolean {
  if (!MUTATING_METHODS.has(method.toUpperCase())) return true;
  if (headers.origin !== undefined) return headers.origin === expectedOrigin;
  if (headers.referer !== undefined) return originOf(headers.referer) === expectedOrigin;
  return false;
}

/**
 * CSRF defence (with SameSite=Lax cookies): rejects cross-origin POST/PUT/PATCH/DELETE
 * with 403 problem+json. Registered with `app.use` before every route, so it also covers
 * Bull Board's mutating actions. OAuth callbacks are GET and unaffected.
 */
export function originCheckMiddleware(publicBaseUrl: string): RequestHandler {
  const expectedOrigin = new URL(publicBaseUrl).origin;
  return (req: Request, res: Response, next: NextFunction) => {
    const { origin, referer } = req.headers;
    if (isSameOriginRequest(req.method, { origin, referer }, expectedOrigin)) return next();
    sendProblem(
      req,
      res,
      new ProblemException({
        status: HttpStatus.FORBIDDEN,
        code: ErrorCode.FORBIDDEN,
        detail: 'Cross-origin request rejected: Origin/Referer does not match the app.',
      }),
    );
  };
}
