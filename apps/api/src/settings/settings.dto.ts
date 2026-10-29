import { queueSlotsSchema, settingsSchema } from '@omero/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Body and response of `GET/PUT /settings`. */
export class SettingsDto extends createZodDto(settingsSchema) {}

/** Body and response of `GET/PUT /queue-slots`: the whole weekly set. */
export class QueueSlotsDto extends createZodDto(queueSlotsSchema) {}

export const nextQueueSlotSchema = z.object({
  /** Next free slot from now (UTC ISO 8601), or null when none exists within 30 days. */
  scheduledAt: z.iso.datetime({ offset: true }).nullable(),
});

/** Response of `GET /queue-slots/next`. */
export class NextQueueSlotDto extends createZodDto(nextQueueSlotSchema) {}
