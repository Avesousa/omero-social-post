import { Module } from '@nestjs/common';
import {
  NotImplementedPublishDeliveryHandler,
  PUBLISH_DELIVERY_HANDLER,
} from './publish-delivery-handler';
import { PublishProcessor } from './publish.processor';
import { SchedulingModule } from './scheduling.module';

@Module({
  imports: [SchedulingModule],
  providers: [
    PublishProcessor,
    // TODO(T024): replace the placeholder with the real publish-delivery handler.
    { provide: PUBLISH_DELIVERY_HANDLER, useClass: NotImplementedPublishDeliveryHandler },
  ],
})
export class SchedulingWorkersModule {}
