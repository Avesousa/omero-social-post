import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { JOB, QUEUE } from '../queues/queue.constants';
import { PUBLISH_DELIVERY_HANDLER, type PublishDeliveryHandler } from './publish-delivery-handler';
import { PublishFlowService } from './publish-flow.service';
import {
  type PublishDeliveryJobData,
  type PublishPostFinalizeJobData,
  type PublishPostJobData,
} from './scheduling.types';

/**
 * Consumer of the `publish` queue (BullMQ runs one Worker per queue, so it dispatches on
 * `job.name`). Orchestration lives in {@link PublishFlowService}; the per-delivery work
 * is delegated to the {@link PublishDeliveryHandler} bound to `PUBLISH_DELIVERY_HANDLER`.
 */
@Processor(QUEUE.publish, { concurrency: 2 })
export class PublishProcessor extends WorkerHost {
  private readonly logger = new Logger(PublishProcessor.name);

  constructor(
    private readonly flow: PublishFlowService,
    @Inject(PUBLISH_DELIVERY_HANDLER) private readonly deliveryHandler: PublishDeliveryHandler,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JOB.publishPost:
        return this.flow.startPublish(job.data as PublishPostJobData);
      case JOB.publishDelivery:
        return this.deliveryHandler.handle(job as Job<PublishDeliveryJobData>);
      case JOB.publishPostFinalize:
        return this.flow.finalize(job.data as PublishPostFinalizeJobData);
      default:
        throw new UnrecoverableError(`Unknown job "${job.name}" on queue "${QUEUE.publish}"`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    this.logger.warn(
      { jobId: job?.id, jobName: job?.name, attemptsMade: job?.attemptsMade, reason: err.message },
      'Publish job failed',
    );
  }
}
