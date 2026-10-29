import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import {
  CreatePostDto,
  ListPostsQueryDto,
  PostDetailDto,
  PostIdParamDto,
  PostListDto,
  UpdatePostDto,
} from './posts.dto';
import { PostsService } from './posts.service';

@ApiTags('posts')
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  /** Calendar range (max 62 days) with a deliveries summary per post. */
  @Get()
  @ZodResponse({ status: HttpStatus.OK, type: PostListDto, description: 'Posts in the range' })
  list(@Query() query: ListPostsQueryDto) {
    return this.posts.list(query);
  }

  /** Creates a draft. 422 VALIDATION_FAILED with field errors when a network rejects it. */
  @Post()
  @ZodResponse({ status: HttpStatus.CREATED, type: PostDetailDto, description: 'The new draft' })
  create(@Body() body: CreatePostDto) {
    return this.posts.create(body);
  }

  /** Full post: deliveries, items, media, attempts and latest metrics. */
  @Get(':id')
  @ZodResponse({ status: HttpStatus.OK, type: PostDetailDto, description: 'The post' })
  get(@Param() { id }: PostIdParamDto) {
    return this.posts.mustGetDetail(id);
  }

  /**
   * Replaces the content of a draft or scheduled post at `version` (409 VERSION_CONFLICT
   * on mismatch, 409 FORBIDDEN_STATE once publishing started). Returns the new version.
   */
  @Put(':id')
  @ZodResponse({ status: HttpStatus.OK, type: PostDetailDto, description: 'The updated post' })
  update(@Param() { id }: PostIdParamDto, @Body() body: UpdatePostDto) {
    return this.posts.update(id, body);
  }

  /** Deletes a draft, scheduled, failed or missed post (409 FORBIDDEN_STATE otherwise). */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Deleted' })
  async remove(@Param() { id }: PostIdParamDto): Promise<void> {
    // TODO(T023): also remove the queued publish job (a stale job is a no-op anyway).
    await this.posts.delete(id);
  }
}
