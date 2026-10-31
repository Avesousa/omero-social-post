import type { Request, Response } from 'express';
import { toProblemDetails } from '../filters/problem-details.filter';
import { PROBLEM_CONTENT_TYPE } from './problem-details';

/**
 * Writes an error as problem+json from plain Express middleware, where Nest's exception
 * filters do not run (e.g. middleware registered with `app.use` in configureApp).
 */
export function sendProblem(req: Request, res: Response, exception: unknown): void {
  const problem = toProblemDetails(exception, req);
  res.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
}
