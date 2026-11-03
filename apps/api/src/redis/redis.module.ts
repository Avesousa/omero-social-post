import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { type Redis } from 'ioredis';
import { RedisLock } from '../common/redis-lock';
import { AppConfig } from '../config/app-config';
import { closeRedis, createRedisConnection } from './redis-connection';

/** General-purpose client: `@Inject(REDIS_CLIENT) private readonly redis: Redis`. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
/** Connection shared by all BullMQ queues and workers (see QueuesModule). */
export const BULLMQ_CONNECTION = Symbol('BULLMQ_CONNECTION');

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(BULLMQ_CONNECTION) private readonly bullmq: Redis,
  ) {}

  // Runs after @nestjs/bullmq has closed its queues/workers (they do not own this
  // shared connection, so they never close it themselves).
  async onApplicationShutdown(): Promise<void> {
    await Promise.all([closeRedis(this.client), closeRedis(this.bullmq)]);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => createRedisConnection(config.env.REDIS_URL, 'client'),
    },
    {
      provide: BULLMQ_CONNECTION,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => createRedisConnection(config.env.REDIS_URL, 'bullmq'),
    },
    {
      provide: RedisLock,
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => new RedisLock(redis),
    },
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT, BULLMQ_CONNECTION, RedisLock],
})
export class RedisModule {}
