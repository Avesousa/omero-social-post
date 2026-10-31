import { Module } from '@nestjs/common';
import { PostLifecycle } from './post-lifecycle';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  controllers: [PostsController],
  providers: [PostsService, PostLifecycle],
  exports: [PostsService, PostLifecycle],
})
export class PostsModule {}
