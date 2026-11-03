import { z } from 'zod';

/** RFC 9457 problem details body returned by every error response of the API. */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string(),
  errors: z.array(
    z.object({
      path: z.string(),
      message: z.string(),
      code: z.string().optional(),
    }),
  ),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * Formats a zod/JSON path as `channels[0].items[1].text`, the shape the web uses to
 * attach messages to form fields.
 */
export function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else out += out ? `.${String(segment)}` : String(segment);
  }
  return out;
}
