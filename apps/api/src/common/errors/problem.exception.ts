import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

/** One field-level error, e.g. `{ path: 'channels[0].items[1].text', message: '...' }`. */
export interface ProblemFieldError {
  path: string;
  message: string;
  code?: string;
}

export interface ProblemInit {
  status: number;
  /** Stable machine-readable code the clients switch on (e.g. VERSION_CONFLICT). */
  code: string;
  /** Human-readable explanation specific to this occurrence. */
  detail?: string;
  /** Short summary; defaults to the HTTP reason phrase. */
  title?: string;
  /** Problem type URI; defaults to `about:blank`. */
  type?: string;
  errors?: ProblemFieldError[];
  cause?: unknown;
}

/**
 * The one exception domain code should throw for expected failures. The global
 * {@link ProblemDetailsFilter} turns it into an RFC 9457 `application/problem+json` body.
 *
 * @example throw ProblemException.conflict('VERSION_CONFLICT', 'The post was modified elsewhere');
 */
export class ProblemException extends HttpException {
  constructor(readonly problem: ProblemInit) {
    super(problem.detail ?? problem.title ?? problem.code, problem.status, {
      cause: problem.cause,
    });
    this.name = 'ProblemException';
  }

  static badRequest(code: string, detail?: string, errors?: ProblemFieldError[]) {
    return new ProblemException({ status: HttpStatus.BAD_REQUEST, code, detail, errors });
  }

  static notFound(detail?: string, code: string = ErrorCode.NOT_FOUND) {
    return new ProblemException({ status: HttpStatus.NOT_FOUND, code, detail });
  }

  static conflict(code: string, detail?: string) {
    return new ProblemException({ status: HttpStatus.CONFLICT, code, detail });
  }

  static unprocessable(code: string, detail?: string, errors?: ProblemFieldError[]) {
    return new ProblemException({ status: HttpStatus.UNPROCESSABLE_ENTITY, code, detail, errors });
  }
}
