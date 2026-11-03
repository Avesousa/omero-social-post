/**
 * Writes the API's OpenAPI document to a file without listening on a port and
 * without connecting to Postgres or Redis (Nest "preview" mode builds the module
 * graph but instantiates no providers).
 *
 * Usage (from apps/api): pnpm openapi:export [output path, default ./openapi.json]
 */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/config/load-env';
import { API_PREFIX, createOpenApiDocument } from '../src/openapi';

async function main(): Promise<void> {
  const output = resolve(process.argv[2] ?? 'openapi.json');

  // Placeholder config: nothing connects in preview mode, but the module graph is
  // built from a validated env. Workers stay on so the document matches production.
  const env = loadEnv({
    NODE_ENV: 'production',
    LOG_LEVEL: 'silent',
    PUBLIC_BASE_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgres://openapi:openapi@localhost:5432/openapi',
    REDIS_URL: 'redis://localhost:6379',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(env), {
    preview: true,
    logger: false,
    abortOnError: false,
  });
  app.setGlobalPrefix(API_PREFIX);
  const document = createOpenApiDocument(app);
  writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  console.warn(`OpenAPI document written to ${output}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
