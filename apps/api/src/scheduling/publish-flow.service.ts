import { InjectFlowProducer } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { type FlowProducer } from 'bullmq';
import { type PostStatus } from '../db/schema';
import { ProblemException } from '../common/errors/problem.exception';
import { PostsService } from '../posts/posts.service';
import { buildPublishFlow } from './publish-flow';
import { type PublishPostFinalizeJobData, type PublishPostJobData } from './scheduling.types';

/** Name of the FlowProducer registered by SchedulingModule. */
export const PUBLISH_FLOW_PRODUCER = 'publish-flow';

export type PublishPostResult =
  | { outcome: 'skipped'; reason: 'post_missing' | 'not_scheduled' | 'stale_version' | 'raced' }
  | { outcome: 'started'; deliveries: number };

export type FinalizeResult =
  | { outcome: 'skipped'; reason: 'post_missing' | 'not_publishing' }
  | { outcome: 'finalized'; status: PostStatus };

/** Worker-side logic of the `publish` queue's two orchestration jobs. */
@Injectable()
export class PublishFlowService {
  private readonly logger = new Logger(PublishFlowService.name);

  constructor(
    private readonly posts: PostsService,
    @InjectFlowProducer(PUBLISH_FLOW_PRODUCER) private readonly flows: FlowProducer,
  ) {}

  /**
   * `publish-post`: the scheduled time has come. Exits as a no-op when the post is gone,
   * is not `scheduled`, or is at another version than the job (it was edited,
   * rescheduled or unscheduled after the job was enqueued). Otherwise marks the post
   * `publishing` (conditional UPDATE) and starts the flow with one `publish-delivery`
   * child per delivery that is still `pending` or `failed`.
   */
  async startPublish({ postId, version }: PublishPostJobData): Promise<PublishPostResult> {
    const snapshot = await this.posts.getForScheduling(postId);
    if (!snapshot) return skipped('post_missing');
    if (snapshot.post.status !== 'scheduled') return skipped('not_scheduled');
    if (snapshot.post.version !== version) return skipped('stale_version');

    const deliveryIds = snapshot.deliveries
      .filter((d) => d.status === 'pending' || d.status === 'failed')
      .map((d) => d.id);

    try {
      await this.posts.transition(postId, {
        from: ['scheduled'],
        to: 'publishing',
        expectedVersion: version,
      });
    } catch (err) {
      // Lost a race with an edit, unschedule or delete between the read and the update.
      if (err instanceof ProblemException && [404, 409].includes(err.problem.status)) {
        return skipped('raced');
      }
      throw err;
    }

    if (deliveryIds.length === 0) {
      // Nothing left to publish: settle the status from what the deliveries already say.
      if (snapshot.deliveries.length > 0) await this.posts.refreshStatus(postId);
      return { outcome: 'started', deliveries: 0 };
    }

    try {
      await this.flows.add(buildPublishFlow({ postId, version, deliveryIds }));
    } catch (err) {
      // Put the post back so the job retry (or the reconciler) can try again.
      await this.posts
        .transition(postId, { from: ['publishing'], to: 'scheduled', expectedVersion: version })
        .catch((revertErr: unknown) =>
          this.logger.error({ postId, err: revertErr }, 'Could not revert post to scheduled'),
        );
      throw err;
    }
    return { outcome: 'started', deliveries: deliveryIds.length };
  }

  /**
   * `publish-post-finalize`: every delivery child has ended (done or failed for good).
   * Derives and stores the post status from its deliveries.
   */
  async finalize({ postId }: PublishPostFinalizeJobData): Promise<FinalizeResult> {
    const snapshot = await this.posts.getForScheduling(postId);
    if (!snapshot) return { outcome: 'skipped', reason: 'post_missing' };
    if (snapshot.post.status !== 'publishing' || snapshot.deliveries.length === 0) {
      return { outcome: 'skipped', reason: 'not_publishing' };
    }
    return { outcome: 'finalized', status: await this.posts.refreshStatus(postId) };
  }
}

function skipped(reason: Extract<PublishPostResult, { outcome: 'skipped' }>['reason']) {
  return { outcome: 'skipped', reason } as const;
}
