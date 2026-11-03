import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { ProblemException } from '../common/errors/problem.exception';
import { type Database, DRIZZLE } from '../db/db.module';
import { notifications } from '../db/schema';
import { type NotificationSeverity, type NotificationType } from '../db/schema/enums';
import { DEFAULT_PAGE_SIZE, type NotificationView } from './notifications.dto';

export type NotificationRow = typeof notifications.$inferSelect;

export interface CreateNotificationInput {
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body?: string | null;
  link?: string | null;
}

export interface ListNotificationsOptions {
  unreadOnly?: boolean;
  limit?: number;
  /** Id of the last item of the previous page. */
  cursor?: string;
}

export interface NotificationPage {
  items: NotificationView[];
  nextCursor: string | null;
  unreadCount: number;
}

export function toNotificationView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** In-app notifications (the tray). Use NotifyService to also reach Telegram. */
@Injectable()
export class NotificationsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(input: CreateNotificationInput): Promise<NotificationRow> {
    const [row] = await this.db
      .insert(notifications)
      .values({
        type: input.type,
        severity: input.severity,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
      })
      .returning();
    return row!;
  }

  findById(id: string): Promise<NotificationRow | undefined> {
    return this.db.query.notifications.findFirst({ where: eq(notifications.id, id) });
  }

  /** Newest first, keyset-paginated on (created_at, id). */
  async list({
    unreadOnly = false,
    limit = DEFAULT_PAGE_SIZE,
    cursor,
  }: ListNotificationsOptions = {}): Promise<NotificationPage> {
    const filters: SQL[] = [];
    if (unreadOnly) filters.push(isNull(notifications.readAt));
    if (cursor) {
      filters.push(
        sql`(${notifications.createdAt}, ${notifications.id}) < (SELECT n.created_at, n.id FROM ${notifications} n WHERE n.id = ${cursor})`,
      );
    }
    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(...filters))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    return {
      items: page.map(toNotificationView),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
      unreadCount: await this.unreadCount(),
    };
  }

  listUnread(
    options: Omit<ListNotificationsOptions, 'unreadOnly'> = {},
  ): Promise<NotificationPage> {
    return this.list({ ...options, unreadOnly: true });
  }

  async unreadCount(): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(notifications)
      .where(isNull(notifications.readAt));
    return row?.n ?? 0;
  }

  /** Marks one notification as read (idempotent: keeps the first read time). */
  async markRead(id: string): Promise<NotificationRow> {
    const [row] = await this.db
      .update(notifications)
      .set({ readAt: sql`COALESCE(${notifications.readAt}, now())` })
      .where(eq(notifications.id, id))
      .returning();
    if (!row) throw ProblemException.notFound('Notification not found');
    return row;
  }

  /** Marks every unread notification as read; returns how many changed. */
  async markAllRead(): Promise<number> {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(isNull(notifications.readAt))
      .returning({ id: notifications.id });
    return rows.length;
  }
}
