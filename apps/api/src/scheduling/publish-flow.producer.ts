import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { type FlowJob, FlowProducer, type JobNode } from 'bullmq';
import { type Redis } from 'ioredis';
import { BULLMQ_PREFIX } from '../queues/queue.constants';
import { BULLMQ_CONNECTION } from '../redis/redis.module';

/**
 * Lazily created BullMQ FlowProducer on the shared BullMQ connection.
 *
 * Created on first use rather than at boot: a FlowProducer that never connected (Redis
 * down) blocks `close()` forever, which would hang application shutdown.
 */
@Injectable()
export class PublishFlowProducer implements OnModuleDestroy {
  private producer?: FlowProducer;

  constructor(@Inject(BULLMQ_CONNECTION) private readonly connection: Redis) {}

  add(flow: FlowJob): Promise<JobNode> {
    this.producer ??= new FlowProducer({ connection: this.connection, prefix: BULLMQ_PREFIX });
    return this.producer.add(flow);
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer?.close();
  }
}
