# API conventions (`apps/api`)

How the NestJS API is organized and how to extend it. Read this before adding a module, a queue processor or a test.

## Layout

```
src/
  main.ts               boots: load env → run migrations → create Nest app
  app.module.ts         AppModule.register(): add new domain modules to `imports`
  app.setup.ts          global prefix /api/v1, helmet, cookie-parser, pipes, filters
  config/               zod-validated env (AppConfig)
  common/               errors (ProblemException), filters, decorators (@Public), logging, redis-lock
  db/                   DbModule (DRIZZLE token), schema/, migrate.ts
  redis/                REDIS_CLIENT provider and connection factory
  queues/               queue.constants (QUEUE, JOB), QueuesModule, WorkersModule, processors/
  crypto/               TokenCipherService (AES-256-GCM, `v1:` format)
  health/               GET /health
  <domain>/             <domain>.module.ts, .service.ts, .controller.ts, (.processor.ts, .workers.module.ts)
```

## Adding a domain module

1. Create `src/<domain>/<domain>.module.ts`, `.service.ts` and `.controller.ts`.
2. Add the module to `imports` in `AppModule.register()` in `src/app.module.ts`.

Dependency injection:

- Config: `constructor(private readonly config: AppConfig)`, then read `config.env.X`.
- Database: `@Inject(DRIZZLE) db: Database`.
- Redis: `@Inject(REDIS_CLIENT)`.
- Locks: inject `RedisLock`.
- Queues are global: `@InjectQueue(QUEUE.publish)`.

Every route is private by default once the session guard exists (T014). Mark public routes with `@Public()`.

**DTOs**

- Use nestjs-zod `createZodDto`, reusing schemas from `@omero/shared` where they exist.
- Document responses with `@ZodResponse` / `Dto.Output`.
- Do not put `.meta({ id })` on DTO root schemas; it breaks OpenAPI generation.

## Errors

Throw `ProblemException`:

- `ProblemException.conflict('VERSION_CONFLICT', detail)`
- `ProblemException.unprocessable(code, detail, errors)`
- `ProblemException.notFound()`
- `new ProblemException({ status, code, detail, errors })`

How the problem+json filter handles errors:

- Field paths look like `channels[0].items[1].text` (helper: `formatIssuePath`).
- Domain error codes come from `@omero/shared` (`ERROR_CODES`).
- Plain Nest `HttpException`s are mapped too.
- Unknown errors become a generic 500 that leaks nothing.

## Queue processors

BullMQ runs one Worker per queue, so a processor switches on `job.name`.

To add one:

1. Write `src/<domain>/<domain>.processor.ts` with `@Processor(QUEUE.x)` extending `WorkerHost`, using `JOB.*` names.
2. Create `src/<domain>/<domain>.workers.module.ts` that imports the domain module and provides the processor.
3. Add it to `WorkersModule.imports`, which is loaded only when `WORKERS_ENABLED=true`.

Rules:

- Throw BullMQ's `UnrecoverableError` for errors that must not be retried.
- BullMQ is **v6**: repeatable jobs are gone. Use `queue.upsertJobScheduler(id, { every | pattern }, template)`.
- Migrations run in `main.ts` before Nest starts, so workers never see an old schema. Any other entry point must migrate first.

## Tests

**Unit tests:** `*.test.ts` next to the code.

**Integration tests:** `test/integration/*.int.test.ts`. Copy `test/integration/harness.int.test.ts` as a starting point.

- Lifecycle: `createTestApp({ env?, imports?, controllers? })` in `beforeAll`, `resetDb(t.db)` in `beforeEach`, `t.close()` in `afterAll`.
- HTTP: `t.http()` (supertest).
- Factories: in `test/factories`; they create missing parents and encrypt tokens with the test key.
- Jobs: `runJobToCompletion(getQueue(t.app, QUEUE.x), name, data)`.
- External APIs: mock with msw v3, e.g. ``server.use(http.post(`${X_API_BASE}/2/tweets`, ...))``. Every unmocked external request fails the test (`onUnhandledFrame`).

**Infrastructure:**

- Uses `TEST_DATABASE_URL` / `TEST_REDIS_URL` when set.
- Otherwise it tries Testcontainers, then falls back to the local `omero_test` database and Redis db 1.
- `TEST_CONTAINERS=false` skips Testcontainers. `TEST_LOG_LEVEL=debug` shows app logs.

**TypeScript:** `test/tsconfig.json` type-checks tests as ESM (msw 3 and Vitest are ESM-only). `src` builds as CommonJS.

## Environment

See `.env.example`:

- **Required:** `PUBLIC_BASE_URL`, `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY`.
- **Optional, set as complete pairs:** X, LinkedIn and Telegram credentials.
