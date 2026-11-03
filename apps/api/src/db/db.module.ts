import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { AppConfig } from '../config/app-config';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

/** Injection token for the drizzle instance: `@Inject(DRIZZLE) private readonly db: Database`. */
export const DRIZZLE = Symbol('DRIZZLE');
/** Injection token for the underlying node-postgres pool (raw SQL, health checks). */
export const PG_POOL = Symbol('PG_POOL');

/** Small pool: one owner, a 1 vCPU box and Postgres tuned for ~300 MB. */
const POOL_MAX = 5;

@Injectable()
class PoolLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Global database module. Migrations are NOT run here: `main.ts` applies them
 * (under an advisory lock) before Nest boots, so no worker or hook can run against an
 * outdated schema. See `runMigrations` in ./migrate.ts.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => {
        const pool = new Pool({
          connectionString: config.env.DATABASE_URL,
          max: POOL_MAX,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
          application_name: 'omero-api',
        });
        // An idle client dying (e.g. Postgres restart) must not crash the process.
        const logger = new Logger('Database');
        pool.on('error', (err) => logger.warn({ err }, 'Idle Postgres client error'));
        return pool;
      },
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => drizzle({ client: pool, schema }),
    },
    PoolLifecycle,
  ],
  exports: [DRIZZLE, PG_POOL],
})
export class DbModule {}
