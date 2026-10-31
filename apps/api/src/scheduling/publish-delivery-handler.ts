import { Injectable } from '@nestjs/common';
import { type Job } from 'bullmq';
import { type PublishDeliveryJobData } from './scheduling.types';

/**
 * What the `publish` worker calls for each `publish-delivery` job.
 *
 * T024 provides the real implementation: replace the `useClass` of the
 * `PUBLISH_DELIVERY_HANDLER` provider in `scheduling.workers.module.ts`. The handler
 * throws a plain `Error` for retryable failures and `UnrecoverableError` for permanent ones.
 */
export interface PublishDeliveryHandler {
  handle(job: Job<PublishDeliveryJobData>): Promise<unknown>;
}

export const PUBLISH_DELIVERY_HANDLER = Symbol('PUBLISH_DELIVERY_HANDLER');

/**
 * PLACEHOLDER until T024 (publish-delivery worker) lands. It only exists so the flow is
 * wired end to end: every delivery child fails and is retried by BullMQ.
 */
@Injectable()
export class NotImplementedPublishDeliveryHandler implements PublishDeliveryHandler {
  handle(): Promise<never> {
    return Promise.reject(new Error('not implemented (T024)'));
  }
}
