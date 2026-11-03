import { type FlowJob } from 'bullmq';
import { JOB, QUEUE } from '../queues/queue.constants';
import {
  PUBLISH_DELIVERY_ATTEMPTS,
  PUBLISH_DELIVERY_BACKOFF,
  PUBLISH_JOB_RETENTION,
  type PublishDeliveryJobData,
  type PublishPostFinalizeJobData,
  publishDeliveryJobId,
  publishFinalizeJobId,
} from './scheduling.types';

export interface PublishFlowInput {
  postId: string;
  /** Post version the flow is started for (the `publish-post` job's version). */
  version: number;
  /** Deliveries to publish: those still `pending` or `failed`. */
  deliveryIds: readonly string[];
}

/**
 * The flow behind one publish run:
 *
 * ```
 * publish-post-finalize  (parent, waits for every child)
 *   ├─ publish-delivery  (delivery A)
 *   └─ publish-delivery  (delivery B)
 * ```
 *
 * Children use `ignoreDependencyOnFailure`, so a child that fails for good still releases
 * the finalizer, which then derives the post status from the deliveries. Keep those
 * options if you build a similar flow elsewhere (e.g. a manual delivery retry).
 *
 * Add it with a `FlowProducer`: `flowProducer.add(buildPublishFlow(input))`.
 */
export function buildPublishFlow({ postId, version, deliveryIds }: PublishFlowInput): FlowJob {
  const finalizeData: PublishPostFinalizeJobData = { postId, version };
  return {
    name: JOB.publishPostFinalize,
    queueName: QUEUE.publish,
    data: finalizeData,
    opts: { jobId: publishFinalizeJobId(postId, version), ...PUBLISH_JOB_RETENTION },
    children: deliveryIds.map((deliveryId): FlowJob => {
      const data: PublishDeliveryJobData = { postId, deliveryId, version };
      return {
        name: JOB.publishDelivery,
        queueName: QUEUE.publish,
        data,
        opts: {
          jobId: publishDeliveryJobId(deliveryId, version),
          attempts: PUBLISH_DELIVERY_ATTEMPTS,
          backoff: PUBLISH_DELIVERY_BACKOFF,
          failParentOnFailure: false,
          ignoreDependencyOnFailure: true,
          ...PUBLISH_JOB_RETENTION,
        },
      };
    }),
  };
}
