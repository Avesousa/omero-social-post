import { getQueueToken } from '@nestjs/bullmq';
import { type INestApplication } from '@nestjs/common';
import { type Job, type JobsOptions, type Queue, QueueEvents } from 'bullmq';
import { type QueueName } from '../../src/queues/queue.constants';
import { closeRedis, createRedisConnection } from '../../src/redis/redis-connection';
import { testInfra } from '../setup/test-env';

export interface RunJobOptions extends JobsOptions {
  /** Max time to wait for the job to complete or fail (default 10 s). */
  timeoutMs?: number;
}

/** The app's injectable Queue for a name, e.g. `getQueue(t.app, QUEUE.maintenance)`. */
export function getQueue(app: INestApplication, name: QueueName): Queue {
  return app.get<Queue>(getQueueToken(name));
}

/**
 * Enqueues a job and waits until a worker finishes it, returning the processor's
 * return value. Rejects with the job's failure reason if it fails (after all
 * attempts). Requires a running worker for the queue (test apps run workers by default).
 *
 * Delayed jobs: pass `delay` and call `await job.promote()` yourself, or enqueue
 * without delay; the helper waits for whatever state change comes first.
 */
export async function runJobToCompletion<R = unknown>(
  queue: Queue,
  name: string,
  data: unknown,
  { timeoutMs = 10_000, ...opts }: RunJobOptions = {},
): Promise<{ job: Job; result: R }> {
  // QueueEvents needs its own blocking connection; never share the app's.
  const connection = createRedisConnection(testInfra().redisUrl, 'bullmq');
  const events = new QueueEvents(queue.name, { connection, prefix: queue.opts.prefix });
  try {
    // Subscribe before adding, so a fast job cannot finish unobserved.
    await events.waitUntilReady();
    const job = await queue.add(name, data, opts);
    const result = (await job.waitUntilFinished(events, timeoutMs)) as R;
    return { job, result };
  } finally {
    await events.close();
    await closeRedis(connection);
  }
}

/** Removes every job of the given queues (between tests that enqueue work). */
export async function obliterateQueues(queues: Queue[]): Promise<void> {
  for (const queue of queues) {
    await queue.obliterate({ force: true });
  }
}
