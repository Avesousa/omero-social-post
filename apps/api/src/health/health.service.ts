import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Redis } from 'ioredis';
import { type Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import { type DependencyCheck, type Health } from './health.dto';

const CHECK_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(): Promise<Health> {
    const [db, redis] = await Promise.all([
      this.probe('db', async () => {
        await this.pool.query('SELECT 1');
      }),
      this.probe('redis', async () => {
        const reply = await this.redis.ping();
        if (reply !== 'PONG') throw new Error(`unexpected PING reply: ${reply}`);
      }),
    ]);
    const status = db.status === 'ok' && redis.status === 'ok' ? 'ok' : 'error';
    return { status, checks: { db, redis } };
  }

  private async probe(name: string, fn: () => Promise<void>): Promise<DependencyCheck> {
    const started = performance.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
        }),
      ]);
      return { status: 'ok', latencyMs: Math.round(performance.now() - started) };
    } catch (err) {
      const timedOut = err instanceof Error && err.message === 'timeout';
      this.logger.warn({ err, dependency: name }, `Health check for ${name} failed`);
      return {
        status: 'error',
        latencyMs: Math.round(performance.now() - started),
        // Details stay in the logs: this endpoint is unauthenticated.
        error: timedOut ? 'timeout' : 'unreachable',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
