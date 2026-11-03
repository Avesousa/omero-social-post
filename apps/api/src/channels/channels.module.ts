import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProvidersModule } from '../providers';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { TokenService } from './token.service';

/**
 * Connected accounts: OAuth connect/callback, settings, disconnect and token handling.
 * Other modules (publish worker, metrics) import this module and inject `TokenService`.
 */
@Module({
  imports: [ProvidersModule, NotificationsModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, TokenService],
  exports: [ChannelsService, TokenService],
})
export class ChannelsModule {}
