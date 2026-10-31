import { Module } from '@nestjs/common';
import { NotificationsModule } from './notifications.module';
import { NotificationsProcessor } from './notifications.processor';

@Module({
  imports: [NotificationsModule],
  providers: [NotificationsProcessor],
})
export class NotificationsWorkersModule {}
