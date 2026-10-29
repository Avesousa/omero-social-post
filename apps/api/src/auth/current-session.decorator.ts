import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { unauthorized } from './session.guard';
import { type AuthSession } from './session.types';

/**
 * Injects the authenticated session: `me(@CurrentSession() session: AuthSession)`.
 * Only meaningful on private routes; on a `@Public()` route without a session it throws 401.
 */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthSession => {
    const session = context.switchToHttp().getRequest<Request>().session;
    if (!session) throw unauthorized();
    return session;
  },
);
