import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type z } from 'zod';
import { type Env, envSchema } from './env.schema';

/** Thrown when the environment does not satisfy {@link envSchema}. The message is safe to print. */
export class EnvValidationError extends Error {
  constructor(readonly issues: Array<{ variable: string; problem: string }>) {
    super(
      [
        'Invalid environment configuration:',
        ...issues.map((i) => `  - ${i.variable}: ${i.problem}`),
        'See apps/api/.env.example for the full list of variables.',
      ].join('\n'),
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates the given environment (defaults to `process.env`) and returns a typed,
 * immutable config. Empty strings are treated as "not set" so `FOO=` in an env file
 * behaves like an omitted variable. Values are never echoed back, since they may be secrets.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvValidationError(describeIssues(result.error, cleaned));
  }
  return Object.freeze(result.data);
}

function describeIssues(error: z.ZodError, input: Record<string, unknown>) {
  return error.issues.map((issue) => {
    const variable = issue.path.join('.') || '(root)';
    const isMissing = issue.path.length === 1 && input[String(issue.path[0])] === undefined;
    return {
      variable,
      problem:
        isMissing && issue.code === 'invalid_type' ? 'is required but not set' : issue.message,
    };
  });
}

/**
 * Loads `.env` from the current working directory into `process.env` when present.
 * Variables already set in the real environment win. Never used in production images,
 * which receive configuration from Docker Compose.
 */
export function loadDotEnvFile(path = resolve(process.cwd(), '.env')): void {
  if (process.env.NODE_ENV === 'production' || !existsSync(path)) return;
  process.loadEnvFile(path);
}
