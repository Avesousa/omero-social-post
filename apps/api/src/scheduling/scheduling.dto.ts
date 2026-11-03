import {
  publishNowSchema,
  queuePostResultSchema,
  queuePostSchema,
  schedulePostSchema,
  versionedActionSchema,
} from '@omero/shared';
import { createZodDto } from 'nestjs-zod';
import { postDetailSchema } from '../posts/posts.dto';

// No `.meta({ id })` on DTO root schemas (see CONVENTIONS.md).

/** Body of `POST /posts/:id/schedule`: `{ at, version }`. */
export class SchedulePostDto extends createZodDto(schedulePostSchema) {}

/** Body of `POST /posts/:id/queue`: `{ version }`. */
export class QueuePostDto extends createZodDto(queuePostSchema) {}

/** Body of `POST /posts/:id/publish-now`: `{ version }`. */
export class PublishNowDto extends createZodDto(publishNowSchema) {}

/** Body of `POST /posts/:id/unschedule`: `{ version }`. */
export class UnschedulePostDto extends createZodDto(versionedActionSchema) {}

/** Response of `POST /posts/:id/queue`: the assigned slot and the updated post. */
export const queuedPostSchema = queuePostResultSchema.extend({ post: postDetailSchema });
export class QueuedPostDto extends createZodDto(queuedPostSchema) {}
