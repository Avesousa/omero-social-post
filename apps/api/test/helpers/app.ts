import { type ModuleMetadata } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { type Env } from '../../src/config/env.schema';
import { type Database, DRIZZLE } from '../../src/db/db.module';
import { testEnv } from '../setup/test-env';

export interface TestApp {
  app: NestExpressApplication;
  env: Env;
  db: Database;
  /** supertest agent bound to the in-process HTTP server. */
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export interface CreateTestAppOptions {
  /** Env overrides, e.g. `{ WORKERS_ENABLED: 'false' }`. */
  env?: Record<string, string | undefined>;
  /** Extra modules (e.g. a test-only module with fake providers). */
  imports?: ModuleMetadata['imports'];
  /** Extra controllers mounted under /api/v1 (handy to exercise pipes and filters). */
  controllers?: ModuleMetadata['controllers'];
}

/**
 * Boots the real AppModule with the production middleware stack (configureApp),
 * against the test Postgres/Redis. Migrations already ran in global setup.
 * Workers are ON by default, so enqueued jobs are processed by the real processors.
 */
export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  const env = testEnv(options.env);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(env, { imports: options.imports })],
    controllers: options.controllers ?? [],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  await app.init();

  return {
    app,
    env,
    db: app.get<Database>(DRIZZLE),
    http: () => request(app.getHttpServer()),
    close: () => app.close(),
  };
}
