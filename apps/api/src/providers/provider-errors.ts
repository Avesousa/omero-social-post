import { type ErrorClass, type ProviderId } from './provider.types';

export interface ProviderErrorInit {
  /** Stable machine-readable code, e.g. RATE_LIMITED, DUPLICATE_CONTENT, TOKEN_REJECTED. */
  code: string;
  /** Human-readable message, safe to show in notifications. Never contains tokens. */
  message: string;
  /** HTTP status from the network, when there was a response. */
  status?: number;
  cause?: unknown;
}

const MAX_DETAIL = 300;

/** Base class of every error an adapter throws on purpose. */
export abstract class ProviderError extends Error {
  abstract readonly kind: ErrorClass;
  readonly code: string;
  readonly status?: number;

  constructor(
    readonly provider: ProviderId,
    init: ProviderErrorInit,
  ) {
    super(init.message, { cause: init.cause });
    this.code = init.code;
    this.status = init.status;
  }
}

/** Transient failure (network, timeout, 429, 5xx). Safe to retry later. */
export class RetryableProviderError extends ProviderError {
  readonly kind = 'retryable' as const;
  readonly retryAfterMs?: number;

  constructor(provider: ProviderId, init: ProviderErrorInit & { retryAfterMs?: number }) {
    super(provider, init);
    this.name = 'RetryableProviderError';
    this.retryAfterMs = init.retryAfterMs;
  }
}

/** The token is expired, revoked or cannot be refreshed: the owner must reconnect the channel. */
export class ReauthRequired extends ProviderError {
  readonly kind = 'auth' as const;

  constructor(provider: ProviderId, init: ProviderErrorInit) {
    super(provider, init);
    this.name = 'ReauthRequired';
  }
}

/** The network rejected the request for good (validation, duplicate, policy). Do not retry. */
export class PermanentProviderError extends ProviderError {
  readonly kind = 'permanent' as const;

  constructor(provider: ProviderId, init: ProviderErrorInit) {
    super(provider, init);
    this.name = 'PermanentProviderError';
  }
}

/**
 * Generic classification. Errors that are not ProviderErrors are bugs or unexpected
 * states; they are treated as permanent so a post that may already be live is never
 * re-sent blindly (network failures are always wrapped as retryable by `providerFetch`).
 */
export function classifyProviderError(err: unknown): ErrorClass {
  return err instanceof ProviderError ? err.kind : 'permanent';
}

/** Trims an upstream error detail so it fits a notification and never dumps a whole body. */
export function truncateDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  const oneLine = detail.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_DETAIL ? `${oneLine.slice(0, MAX_DETAIL - 1)}…` : oneLine;
}
