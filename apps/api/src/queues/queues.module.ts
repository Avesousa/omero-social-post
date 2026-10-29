import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { type Redis } from 'ioredis';
import { SessionAuthMiddleware } from '../auth/session-auth.middleware';
import { BULLMQ_CONNECTION } from '../redis/redis.module';
import {
  BULL_BOARD_ROUTE,
  BULLMQ_PREFIX,
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
} from './queue.constants';

/**
 * Registers the BullMQ connection, the four queues and Bull Board.
 *
 * Producers: inject a queue anywhere with `@InjectQueue(QUEUE.x)`; this module is global.
 * Consumers: processors are NOT declared here; see WorkersModule (only loaded when
 * WORKERS_ENABLED=true).
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [BULLMQ_CONNECTION],
      useFactory: (connection: Redis) => ({ connection, prefix: BULLMQ_PREFIX }),
    }),
    BullModule.registerQueue(
      ...QUEUE_NAMES.map((name) => ({ name, defaultJobOptions: DEFAULT_JOB_OPTIONS })),
    ),
    BullBoardModule.forRoot({
      route: BULL_BOARD_ROUTE,
      adapter: ExpressAdapter,
      // Runs before the board's router: 401 problem+json without a valid session. Its
      // SessionService dependency resolves from the global AuthModule.
      middleware: SessionAuthMiddleware,
    }),
    BullBoardModule.forFeature(...QUEUE_NAMES.map((name) => ({ name, adapter: BullMQAdapter }))),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
