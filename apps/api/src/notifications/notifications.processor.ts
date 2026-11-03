import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { JOB, QUEUE } from '../queues/queue.constants';
import { NotifyService, type TelegramJobData } from './notify.service';

/** Consumer of the `notify` queue (Telegram delivery). */
@Processor(QUEUE.notify, { concurrency: 1 })
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly notify: NotifyService) {
    super();
  }

  async process(job: Job<TelegramJobData>): Promise<unknown> {
    switch (job.name) {
      case JOB.telegram:
        return this.notify.deliverTelegram(job.data);
      default:
        throw new UnrecoverableError(`Unknown job "${job.name}" on queue "${QUEUE.notify}"`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    // err.message is built by TelegramClient and never contains the bot token.
    this.logger.warn(
      { jobId: job?.id, jobName: job?.name, attemptsMade: job?.attemptsMade, reason: err.message },
      'Notify job failed',
    );
  }
}
