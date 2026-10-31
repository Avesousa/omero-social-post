import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const dependencyCheckSchema = z.object({
  status: z.enum(['ok', 'error']),
  latencyMs: z.number().int().nonnegative(),
  /** Short, non-sensitive reason when status is `error`. */
  error: z.string().optional(),
});

// No `.meta({ id })` on DTO root schemas: nestjs-zod names them after the DTO class
// and a root id produces a duplicate-schema error in cleanupOpenApiDoc.
export const healthSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.object({
    db: dependencyCheckSchema,
    redis: dependencyCheckSchema,
  }),
});

export type Health = z.infer<typeof healthSchema>;
export type DependencyCheck = Health['checks']['db'];

export class HealthDto extends createZodDto(healthSchema) {}
