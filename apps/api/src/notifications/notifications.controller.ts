import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import {
  ListNotificationsQueryDto,
  MarkAllReadResultDto,
  NotificationDto,
  NotificationListDto,
} from './notifications.dto';
import { NotificationsService, toNotificationView } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Newest first. `?unread=true` for the tray; paginate with `cursor`. */
  @Get()
  @ZodResponse({ status: HttpStatus.OK, type: NotificationListDto, description: 'Notifications' })
  list(@Query() query: ListNotificationsQueryDto) {
    return this.notifications.list({
      unreadOnly: query.unread,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ status: HttpStatus.OK, type: MarkAllReadResultDto, description: 'Marked' })
  async readAll() {
    return { count: await this.notifications.markAllRead() };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ status: HttpStatus.OK, type: NotificationDto, description: 'Marked as read' })
  async read(@Param('id', new ParseUUIDPipe()) id: string) {
    return toNotificationView(await this.notifications.markRead(id));
  }
}
