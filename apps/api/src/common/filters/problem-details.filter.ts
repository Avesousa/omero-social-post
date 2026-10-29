import { STATUS_CODES } from 'node:http';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { ErrorCode, errorCodeForStatus } from '../errors/error-codes';
import {
  formatIssuePath,
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
} from '../errors/problem-details';
import { type ProblemFieldError, ProblemException } from '../errors/problem.exception';

/**
 * Global filter rendering every HTTP error as RFC 9457 `application/problem+json`:
 * `{ type, title, status, detail, instance, code, errors[] }`.
 *
 * - {@link ProblemException}: rendered as given (preferred for domain errors).
 * - nestjs-zod `ZodValidationException`: 400 `VALIDATION_FAILED` with one entry per issue.
 * - Any Nest `HttpException`: status preserved, code derived from the status.
 * - Errors from Express middleware (e.g. body-parser) carrying `status` + `expose`.
 * - Anything else: logged, answered with a generic 500 that leaks no internals.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const problem = toProblemDetails(exception, req);
    if (problem.status >= 500) {
      this.logger.error(
        { err: exception, code: problem.code },
        `Unhandled error on ${req.method} ${problem.instance}`,
      );
    }
    if (res.headersSent) return;
    res.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
  }
}

export function toProblemDetails(exception: unknown, req?: Pick<Request, 'originalUrl' | 'url'>) {
  const instance = req ? (req.originalUrl ?? req.url).split('?')[0] : undefined;
  const build = (
    status: number,
    code: string,
    detail?: string,
    errors: ProblemFieldError[] = [],
    title?: string,
    type = 'about:blank',
  ): ProblemDetails => ({
    type,
    title: title ?? STATUS_CODES[status] ?? 'Error',
    status,
    ...(detail ? { detail } : {}),
    ...(instance ? { instance } : {}),
    code,
    errors,
  });

  if (exception instanceof ProblemException) {
    const p = exception.problem;
    return build(p.status, p.code, p.detail, p.errors, p.title, p.type);
  }

  if (exception instanceof ZodValidationException) {
    return build(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_FAILED,
      'The request did not pass validation.',
      zodIssuesToFieldErrors(exception.getZodError()),
    );
  }

  if (exception instanceof ZodSerializationException) {
    // A response failed its own schema: a server bug, never the client's fault.
    return build(HttpStatus.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL_ERROR);
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return build(
      status,
      errorCodeForStatus(status),
      status >= 500 ? undefined : httpExceptionDetail(exception),
    );
  }

  // Errors raised by Express middleware (e.g. body-parser's 413) follow the
  // `http-errors` convention: `status` plus `expose` when the message is client-safe.
  // (Invalid JSON is already mapped to a BadRequestException by Nest.)
  const httpError = exception as { status?: unknown; expose?: unknown; message?: unknown };
  if (
    typeof httpError?.status === 'number' &&
    httpError.status >= 400 &&
    httpError.status < 500 &&
    httpError.expose === true
  ) {
    return build(
      httpError.status,
      errorCodeForStatus(httpError.status),
      String(httpError.message ?? ''),
    );
  }

  return build(HttpStatus.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL_ERROR);
}

function httpExceptionDetail(exception: HttpException): string | undefined {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' ? message : undefined;
}

function zodIssuesToFieldErrors(error: unknown): ProblemFieldError[] {
  const issues = (error as { issues?: unknown })?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.map((issue: { path?: PropertyKey[]; message?: string; code?: string }) => ({
    path: formatIssuePath(issue.path ?? []),
    message: issue.message ?? 'Invalid value',
    ...(issue.code ? { code: issue.code } : {}),
  }));
}
