import { Body, Controller, Get, HttpStatus, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { QueueSlotsService } from './queue-slots.service';
import { NextQueueSlotDto, QueueSlotsDto, SettingsDto } from './settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ZodResponse({ status: HttpStatus.OK, type: SettingsDto, description: 'Current settings' })
  get() {
    return this.settings.get();
  }

  @Put()
  @ZodResponse({ status: HttpStatus.OK, type: SettingsDto, description: 'Saved settings' })
  update(@Body() body: SettingsDto) {
    return this.settings.update(body);
  }
}

@ApiTags('queue-slots')
@Controller('queue-slots')
export class QueueSlotsController {
  constructor(private readonly queueSlots: QueueSlotsService) {}

  @Get()
  @ZodResponse({ status: HttpStatus.OK, type: QueueSlotsDto, description: 'Weekly queue slots' })
  list() {
    return this.queueSlots.list();
  }

  /** Replaces the whole weekly set. */
  @Put()
  @ZodResponse({ status: HttpStatus.OK, type: QueueSlotsDto, description: 'Saved queue slots' })
  replace(@Body() body: QueueSlotsDto) {
    return this.queueSlots.replace(body);
  }

  /** Preview of the slot "Add to queue" would assign right now. */
  @Get('next')
  @ZodResponse({ status: HttpStatus.OK, type: NextQueueSlotDto, description: 'Next free slot' })
  async next() {
    const at = await this.queueSlots.findNextFreeSlot();
    return { scheduledAt: at?.toISOString() ?? null };
  }
}
