/** Minimum password length enforced by the API (`PASSWORD_MIN_LENGTH`). */
export const PASSWORD_MIN_LENGTH = 12;

export type PasswordStrength = 'empty' | 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordStrengthResult {
  level: PasswordStrength;
  /** Filled segments of the meter, 0 to 4. */
  score: 0 | 1 | 2 | 3 | 4;
}

/**
 * Cheap, offline strength estimate for the meter next to the setup password field.
 * It is only a hint: the API is the one that enforces the minimum length.
 * Length dominates; character variety and repetition adjust it.
 */
export function estimatePasswordStrength(password: string): PasswordStrengthResult {
  if (password.length === 0) return { level: 'empty', score: 0 };

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const unique = new Set(password).size;

  let points = 0;
  if (password.length >= PASSWORD_MIN_LENGTH) points += 1;
  if (password.length >= 16) points += 1;
  if (password.length >= 20) points += 1;
  if (classes >= 3) points += 1;
  // Long runs of the same few characters ("aaaaaaaaaaaa") are not strong whatever their length.
  if (unique < Math.min(8, password.length / 2)) points = Math.min(points, 1);
  if (password.length < PASSWORD_MIN_LENGTH) points = 0;

  const score = Math.max(points, 1) as 1 | 2 | 3 | 4;
  const level: PasswordStrength = (['weak', 'fair', 'good', 'strong'] as const)[score - 1]!;
  return { level, score };
}
