import { Module } from '@nestjs/common';
import { QueueSlotsService } from './queue-slots.service';
import { QueueSlotsController, SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/** Owner settings (timezone, missed-post grace window) and weekly queue slots. */
@Module({
  controllers: [SettingsController, QueueSlotsController],
  providers: [SettingsService, QueueSlotsService],
  exports: [SettingsService, QueueSlotsService],
})
export class SettingsModule {}
