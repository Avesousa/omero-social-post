import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module';
import { SettingsModule } from '../settings/settings.module';
import { PublishFlowProducer } from './publish-flow.producer';
import { PublishFlowService } from './publish-flow.service';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';

/**
 * Schedule / queue / publish-now / unschedule endpoints, the delayed `publish-post` job
 * and the flow that fans out to deliveries. The consumer side (processor) is in
 * SchedulingWorkersModule, loaded only when WORKERS_ENABLED=true.
 */
@Module({
  imports: [PostsModule, SettingsModule],
  controllers: [SchedulingController],
  providers: [SchedulingService, PublishFlowService, PublishFlowProducer],
  exports: [SchedulingService, PublishFlowService],
})
export class SchedulingModule {}
