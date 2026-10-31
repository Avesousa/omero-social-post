/** One field-level validation issue. `path` looks like `channels[0].items[1].text`. */
export interface ProblemFieldError {
  path: string;
  message: string;
  code?: string;
}

/** RFC 9457 problem details body returned by every error response of the API. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  /** Stable machine-readable code (see `ERROR_CODES` in `@omero/shared`). */
  code: string;
  errors: ProblemFieldError[];
}

/**
 * Thrown by every generated request function (and therefore by every hook) when the
 * API answers with a non-2xx status. It carries the problem+json body so the UI can
 * branch on `code` and attach `errors[]` to form fields.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly code: string;
  readonly detail: string | undefined;
  readonly errors: ProblemFieldError[];
  /** Full problem body when the API sent one; `undefined` for non-problem responses (e.g. a proxy error page). */
  readonly problem: ProblemDetails | undefined;
  /** Raw parsed body, useful when the error response is not problem+json (for example a 503 health payload). */
  readonly body: unknown;

  constructor(status: number, body: unknown, statusText = '') {
    const problem = isProblemDetails(body) ? body : undefined;
    super(
      problem?.detail ?? problem?.title ?? (statusText || `Request failed with status ${status}`),
    );
    this.status = status;
    this.problem = problem;
    this.body = body;
    this.code = problem?.code ?? `HTTP_${status}`;
    this.detail = problem?.detail;
    this.errors = problem?.errors ?? [];
  }

  /** Message for one form field, matched by its full path (`channels[0].items[1].text`). */
  fieldError(path: string): string | undefined {
    return this.errors.find((error) => error.path === path)?.message;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

function isProblemDetails(value: unknown): value is ProblemDetails {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.status === 'number' &&
    typeof candidate.code === 'string' &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.errors)
  );
}
