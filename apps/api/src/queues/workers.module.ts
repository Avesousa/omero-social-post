import { Module } from '@nestjs/common';
import { NotificationsWorkersModule } from '../notifications/notifications.workers.module';
import { MaintenanceProcessor } from './processors/maintenance.processor';

/**
 * Every BullMQ processor in the API is reachable only through this module, and
 * AppModule imports it only when WORKERS_ENABLED=true. With workers disabled no
 * Worker (and no blocking Redis connection) is ever created, so an HTTP-only
 * instance can run next to a dedicated worker container.
 *
 * To add consumers for a domain:
 *   1. Create `src/<domain>/<domain>.processor.ts` with `@Processor(QUEUE.x)`.
 *   2. Create `src/<domain>/<domain>.workers.module.ts`:
 *        @Module({ imports: [<Domain>Module], providers: [<Domain>Processor] })
 *   3. Add that module to `imports` below.
 */
@Module({
  imports: [NotificationsWorkersModule],
  providers: [MaintenanceProcessor],
})
export class WorkersModule {}
