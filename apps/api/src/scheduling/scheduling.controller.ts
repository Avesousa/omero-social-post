import { Body, Controller, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { PostDetailDto, PostIdParamDto } from '../posts/posts.dto';
import {
  PublishNowDto,
  QueuedPostDto,
  QueuePostDto,
  SchedulePostDto,
  UnschedulePostDto,
} from './scheduling.dto';
import { SchedulingService } from './scheduling.service';

/**
 * Scheduling actions on a post. Every body carries the `version` the client last saw
 * (409 VERSION_CONFLICT on mismatch); every success returns the updated post.
 */
@ApiTags('posts')
@Controller('posts')
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  /** Schedules a draft, or reschedules a scheduled post. 422 when `at` is in the past. */
  @Post(':id/schedule')
  @ZodResponse({ status: HttpStatus.OK, type: PostDetailDto, description: 'The scheduled post' })
  schedule(@Param() { id }: PostIdParamDto, @Body() body: SchedulePostDto) {
    return this.scheduling.schedule(id, body);
  }

  /** Puts the post in the earliest free queue slot. 422 NO_FREE_SLOT when there is none. */
  @Post(':id/queue')
  @ZodResponse({
    status: HttpStatus.OK,
    type: QueuedPostDto,
    description: 'The assigned slot and the scheduled post',
  })
  queue(@Param() { id }: PostIdParamDto, @Body() { version }: QueuePostDto) {
    return this.scheduling.queue(id, version);
  }

  /** Publishes as soon as a worker is free. */
  @Post(':id/publish-now')
  @ZodResponse({ status: HttpStatus.OK, type: PostDetailDto, description: 'The post, queued now' })
  publishNow(@Param() { id }: PostIdParamDto, @Body() { version }: PublishNowDto) {
    return this.scheduling.publishNow(id, version);
  }

  /** Takes a scheduled post back to draft and drops its delayed job. */
  @Post(':id/unschedule')
  @ZodResponse({ status: HttpStatus.OK, type: PostDetailDto, description: 'The draft' })
  unschedule(@Param() { id }: PostIdParamDto, @Body() { version }: UnschedulePostDto) {
    return this.scheduling.unschedule(id, version);
  }
}
