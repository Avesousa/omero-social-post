import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// No `.meta({ id })` on DTO root schemas (see CONVENTIONS.md).
export const mediaSchema = z.object({
  id: z.uuid(),
  mime: z.string(),
  bytes: z.int().nonnegative(),
  width: z.int().nullable(),
  height: z.int().nullable(),
  /** Same-origin URL, e.g. `/api/v1/media/<id>`. */
  url: z.string(),
});

export class MediaDto extends createZodDto(mediaSchema) {}

export class MediaIdParamDto extends createZodDto(z.object({ id: z.uuid() })) {}
