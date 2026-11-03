import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ErrorCode } from '../common/errors/error-codes';
import { ProblemException } from '../common/errors/problem.exception';
import { SessionService } from './session.service';

export function unauthorized(): ProblemException {
  return new ProblemException({
    status: HttpStatus.UNAUTHORIZED,
    code: ErrorCode.UNAUTHORIZED,
    detail: 'A valid session is required.',
  });
}

/**
 * Global guard (APP_GUARD): every route requires a session unless the handler or its
 * controller is marked `@Public()`. On success `req.session = { sessionId, userId }`.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const session = await this.sessions.authenticateRequest(
      http.getRequest<Request>(),
      http.getResponse<Response>(),
    );
    if (!session) throw unauthorized();
    return true;
  }
}
