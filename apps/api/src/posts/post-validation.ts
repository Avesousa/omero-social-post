import { type FieldError, PROVIDER_LIMITS, type ProviderLimitsMap } from '@omero/shared';
import { formatIssuePath } from '../common/errors/problem-details';
import { type ProblemFieldError } from '../common/errors/problem.exception';

/**
 * Limits used to validate posts in the API. Same as {@link PROVIDER_LIMITS}, except that
 * WebP counts as accepted wherever JPEG is: the media pipeline converts WebP to JPEG for
 * networks that reject it (LinkedIn), see `MediaService.prepareForProvider`.
 */
export const VALIDATION_LIMITS: ProviderLimitsMap = Object.fromEntries(
  Object.entries(PROVIDER_LIMITS).map(([provider, limits]) => [
    provider,
    limits.allowedMimeTypes.includes('image/jpeg') &&
    !limits.allowedMimeTypes.includes('image/webp')
      ? { ...limits, allowedMimeTypes: [...limits.allowedMimeTypes, 'image/webp'] }
      : limits,
  ]),
) as unknown as ProviderLimitsMap;

/** `channels.0.items.1.text` (shared validation) -> `channels[0].items[1].text` (API errors). */
export function toProblemPath(dotted: string): string {
  return formatIssuePath(
    dotted
      .split('.')
      .filter(Boolean)
      .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment)),
  );
}

export function toProblemFieldErrors(errors: readonly FieldError[]): ProblemFieldError[] {
  return errors.map((e) => ({ path: toProblemPath(e.path), code: e.code, message: e.message }));
}
