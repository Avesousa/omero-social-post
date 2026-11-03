import { notificationTypeSchema } from '@omero/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { NOTIFICATION_SEVERITIES } from '../db/schema/enums';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const notificationSchema = z.object({
  id: z.uuid(),
  type: notificationTypeSchema,
  severity: z.enum(NOTIFICATION_SEVERITIES),
  title: z.string(),
  body: z.string().nullable(),
  /** In-app path, e.g. `/posts/<id>`. */
  link: z.string().nullable(),
  readAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type NotificationView = z.infer<typeof notificationSchema>;

export const listNotificationsQuerySchema = z.object({
  /** `true` returns only unread notifications. */
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  /** `nextCursor` from the previous page. */
  cursor: z.uuid().optional(),
});

export const notificationListSchema = z.object({
  /** Newest first. */
  items: z.array(notificationSchema),
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: z.uuid().nullable(),
  unreadCount: z.int().nonnegative(),
});

export const markAllReadResultSchema = z.object({
  /** How many notifications were marked as read. */
  count: z.int().nonnegative(),
});

export class NotificationDto extends createZodDto(notificationSchema) {}
export class ListNotificationsQueryDto extends createZodDto(listNotificationsQuerySchema) {}
export class NotificationListDto extends createZodDto(notificationListSchema) {}
export class MarkAllReadResultDto extends createZodDto(markAllReadResultSchema) {}
