import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { sendProblem } from '../common/errors/send-problem';
import { unauthorized } from './session.guard';
import { SessionService } from './session.service';

/**
 * Session check for routes Nest guards do not cover: Bull Board (mounted as Express
 * middleware by @bull-board/nestjs) and the raw `/api/v1/openapi.json` handler.
 * Unauthenticated requests get a 401 problem+json.
 */
@Injectable()
export class SessionAuthMiddleware implements NestMiddleware {
  constructor(private readonly sessions: SessionService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    this.sessions
      .authenticateRequest(req, res)
      .then((session) => (session ? next() : sendProblem(req, res, unauthorized())), next);
  }
}
