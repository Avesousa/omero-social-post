import { providerIdSchema, providerLimitsSchema } from '@omero/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// No `.meta({ id })` on DTO root schemas (see CONVENTIONS.md).
export const providerInfoSchema = z.object({
  id: providerIdSchema,
  /** True when the provider's client id and secret are set in env. */
  configured: z.boolean(),
  /** Env variable names still missing; empty when configured. */
  missingEnv: z.array(z.string()),
  limits: providerLimitsSchema,
});

export class ProviderInfoDto extends createZodDto(providerInfoSchema) {}
