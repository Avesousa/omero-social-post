import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import pino from 'pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { buildBaseLoggerOptions } from './common/logging/logger.options';
import { type Env } from './config/env.schema';
import { EnvValidationError, loadDotEnvFile, loadEnv } from './config/load-env';
import { runMigrations } from './db/migrate';

function loadEnvOrExit(): Env {
  loadDotEnvFile();
  try {
    return loadEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      // Plain stderr: the logger is not configured yet and this must be readable.
      console.error(`\n${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

async function bootstrap(): Promise<void> {
  const env = loadEnvOrExit();
  const bootLogger = pino(buildBaseLoggerOptions(env));

  try {
    // Before Nest boots: no worker or lifecycle hook may run against an old schema.
    // Concurrent instances serialize on a Postgres advisory lock.
    await runMigrations(env.DATABASE_URL, {
      log: (message) => bootLogger.info({ context: 'Database' }, message),
    });

    const app = await NestFactory.create<NestExpressApplication>(AppModule.register(env), {
      bufferLogs: true,
    });
    const logger = app.get(Logger);
    app.useLogger(logger);
    configureApp(app);
    await app.listen(env.PORT, env.HOST);

    logger.log(
      `API listening on http://${env.HOST}:${env.PORT}/api/v1 (workers ${env.WORKERS_ENABLED ? 'enabled' : 'disabled'})`,
      'Bootstrap',
    );
  } catch (err) {
    bootLogger.fatal({ err }, 'API failed to start');
    process.exitCode = 1;
    // Give the logger transport a moment to flush, then make sure we exit even if
    // a half-open connection keeps the event loop alive.
    setTimeout(() => process.exit(1), 500).unref();
  }
}

void bootstrap();
