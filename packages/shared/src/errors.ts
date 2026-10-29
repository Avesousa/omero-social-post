import { z } from 'zod';

/** Machine-readable error codes carried in the `code` field of problem+json responses. */
export const ERROR_CODES = [
  'NO_FREE_SLOT',
  'VERSION_CONFLICT',
  'VALIDATION_FAILED',
  'SETUP_ALREADY_DONE',
  'INVALID_CREDENTIALS',
  'CHANNEL_NOT_CONFIGURED',
  'REAUTH_REQUIRED',
  'NOT_FOUND',
  'FORBIDDEN_STATE',
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Default HTTP status for each error code, so the API exception filter and clients agree. */
export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  NO_FREE_SLOT: 422,
  VERSION_CONFLICT: 409,
  VALIDATION_FAILED: 422,
  SETUP_ALREADY_DONE: 409,
  INVALID_CREDENTIALS: 401,
  CHANNEL_NOT_CONFIGURED: 409,
  REAUTH_REQUIRED: 409,
  NOT_FOUND: 404,
  FORBIDDEN_STATE: 409,
};

/** One field-level error, pointing at a dotted path such as `channels.0.items.1.text`. */
export const fieldErrorSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;

/** RFC 9457 `application/problem+json` body. */
export const problemDetailsSchema = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.int().min(100).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: errorCodeSchema.optional(),
  errors: z.array(fieldErrorSchema).optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const PROBLEM_JSON_CONTENT_TYPE = 'application/problem+json';
