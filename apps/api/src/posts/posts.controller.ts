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
import { PostLifecycle } from './post-lifecycle';
import { PostsService } from './posts.service';

@ApiTags('posts')
@Controller('posts')
export class PostsController {
  constructor(
    private readonly posts: PostsService,
    private readonly lifecycle: PostLifecycle,
  ) {}

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
  async update(@Param() { id }: PostIdParamDto, @Body() body: UpdatePostDto) {
    const post = await this.posts.update(id, body);
    // A scheduled post's queued job is keyed by version: the scheduler re-enqueues it.
    await this.lifecycle.emitUpdated({ postId: id });
    return post;
  }

  /** Deletes a draft, scheduled, failed or missed post (409 FORBIDDEN_STATE otherwise). */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Deleted' })
  async remove(@Param() { id }: PostIdParamDto): Promise<void> {
    const deleted = await this.posts.delete(id);
    // The scheduler drops the queued publish job (a stale job would be a no-op anyway).
    await this.lifecycle.emitDeleted({ post: deleted });
  }
}
