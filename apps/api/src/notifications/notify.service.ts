import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';
import { AppConfig } from '../config/app-config';
import { type NotificationType } from '../db/schema/enums';
import { JOB, QUEUE } from '../queues/queue.constants';
import { SettingsService } from '../settings/settings.service';
import {
  buildNotification,
  formatTelegramMessage,
  type NotificationPayloads,
} from './notification-messages';
import { type NotificationRow, NotificationsService } from './notifications.service';
import { TelegramClient } from './telegram.client';

/** Data of a `telegram` job on the notify queue. The row is re-read when it runs. */
export interface TelegramJobData {
  notificationId: string;
}

/**
 * 5 attempts with exponential backoff (30 s, 1, 2, 4 min), so a Telegram outage is
 * absorbed without ever blocking publishing.
 */
export const TELEGRAM_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
};

export interface NotifyResult {
  notification: NotificationRow;
  /** BullMQ job id when a Telegram message was enqueued. */
  telegramJobId?: string;
}

export type TelegramDeliveryResult =
  | { sent: true; messageId?: number }
  | { sent: false; skipped: 'not_configured' | 'notification_not_found' };

/** Raises owner notifications: always an in-app row, plus Telegram when configured. */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly telegram: TelegramClient,
    private readonly config: AppConfig,
    @InjectQueue(QUEUE.notify) private readonly notifyQueue: Queue<TelegramJobData>,
  ) {}

  /**
   * Writes the notification row and, if TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID are set,
   * enqueues its Telegram delivery.
   *
   * @example await notify.notify('delivery_failed', { postId, provider: 'x', reason, preview });
   */
  async notify<T extends NotificationType>(
    type: T,
    payload: NotificationPayloads[T],
  ): Promise<NotifyResult> {
    const timeZone = await this.settings.getTimezone();
    const content = buildNotification(type, payload, { timeZone });
    const notification = await this.notifications.create({ type, ...content });

    if (!this.telegram.isConfigured) return { notification };

    const job = await this.notifyQueue.add(
      JOB.telegram,
      { notificationId: notification.id },
      // jobId makes enqueueing idempotent per notification.
      { ...TELEGRAM_JOB_OPTIONS, jobId: `telegram-${notification.id}` },
    );
    this.logger.debug({ notificationId: notification.id, type }, 'Telegram notification queued');
    return { notification, telegramJobId: job.id };
  }

  /** Runs a `telegram` job: renders the stored notification and sends it. */
  async deliverTelegram({ notificationId }: TelegramJobData): Promise<TelegramDeliveryResult> {
    if (!this.telegram.isConfigured) return { sent: false, skipped: 'not_configured' };
    const notification = await this.notifications.findById(notificationId);
    if (!notification) return { sent: false, skipped: 'notification_not_found' };

    const text = formatTelegramMessage(notification, this.config.env.PUBLIC_BASE_URL);
    const messageId = await this.telegram.sendMessage(text);
    return { sent: true, messageId };
  }
}
