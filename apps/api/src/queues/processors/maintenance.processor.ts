import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { JOB, QUEUE } from '../queue.constants';

/**
 * Consumer of the `maintenance` queue. BullMQ runs one Worker per queue, so the
 * processor dispatches on `job.name`; later tasks add `reconcile` and
 * `token-expiry-check` cases that delegate to their domain services.
 */
@Processor(QUEUE.maintenance, { concurrency: 1 })
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JOB.noop:
        return { ok: true, data: job.data as unknown };
      default:
        // Unknown jobs can never succeed; do not burn retries on them.
        throw new UnrecoverableError(`Unknown job "${job.name}" on queue "${QUEUE.maintenance}"`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    this.logger.warn({ jobId: job?.id, jobName: job?.name, err }, 'Maintenance job failed');
  }
}
