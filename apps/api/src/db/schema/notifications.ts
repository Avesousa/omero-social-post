import { index, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, id, tstz } from './columns';
import { type NotificationSeverity, notificationTypeEnum } from './enums';

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    type: notificationTypeEnum('type').notNull(),
    severity: text('severity').$type<NotificationSeverity>().notNull().default('info'),
    title: text('title').notNull(),
    body: text('body'),
    /** In-app path to open, e.g. `/posts/<id>`. */
    link: text('link'),
    readAt: tstz('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_read_at_created_at_idx').on(t.readAt, t.createdAt.desc())],
);
