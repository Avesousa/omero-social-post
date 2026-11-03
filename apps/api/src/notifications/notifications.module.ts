import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotifyService } from './notify.service';
import { TelegramClient } from './telegram.client';

/**
 * In-app notifications and their Telegram fan-out. Other modules import this module
 * and call `NotifyService.notify(type, payload)`.
 */
@Module({
  imports: [SettingsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotifyService, TelegramClient],
  exports: [NotificationsService, NotifyService],
})
export class NotificationsModule {}
