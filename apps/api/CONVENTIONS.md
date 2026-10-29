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

## Authentication

Every route is private: the global `SessionGuard` (APP_GUARD, `src/auth`) answers 401 `UNAUTHORIZED` without a valid `omero_session` cookie. Mark public routes with `@Public()` and add them to the allowlist in `test/integration/auth-security.int.test.ts` (that test fails on any unexpected public route).

- Read the session with `@CurrentSession() session: AuthSession` (`import { CurrentSession, type AuthSession } from '../auth'`). Shape: `{ sessionId, userId }`. `sessionId` is the stored sha256 of the cookie token, safe to use as a key (e.g. to bind OAuth state).
- `req.session` carries the same object (typed through the global `Express.Request` augmentation in `src/auth/session.types.ts`).
- Routes outside Nest's router (plain Express middleware) are protected with `SessionAuthMiddleware`, as Bull Board and `/api/v1/openapi.json` are (openapi.json stays open when `NODE_ENV=development`).
- CSRF: every POST/PUT/PATCH/DELETE must carry an `Origin` (or, without it, a `Referer`) matching `PUBLIC_BASE_URL`, otherwise 403 `FORBIDDEN`. This runs as `app.use` middleware before any route. OAuth callbacks are GET, so they are unaffected.
- Rate limiting: `@nestjs/throttler` with Redis storage, used only by `LoginThrottlerGuard` on `POST /auth/login`. To throttle another route, add a named throttler in `AuthModule` and skip the login one with `@SkipThrottle({ login: true })`.

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
- HTTP: `t.http()` is a supertest agent that sends `Origin: PUBLIC_BASE_URL` (so mutating requests pass the CSRF check) and **no session**. `t.rawHttp()` is plain supertest without default headers, for CSRF tests.
- Auth (`test/helpers/auth.ts`):
  - `const owner = await loginAs(t)` creates the owner if missing and a session through `SessionService` (fast, and it never uses up the login throttle). Use `owner.http.get(...)` / `.post(...)`, an agent with the cookie and `Origin` set. Also returns `user`, `token`, `sessionId` and `cookie` (`omero_session=<token>`).
  - `createOwner(t, creds?)` inserts the user only. `TEST_OWNER` has the default credentials.
  - `sessionSetCookie(res)` returns the `omero_session` Set-Cookie line.
  - `resetThrottle(t)` clears login throttle counters; they live in Redis and survive `resetDb`. Call it in `beforeEach` when a suite logs in through `POST /auth/login`.
  - Test controllers passed through `createTestApp({ controllers })` are private too: use `loginAs(t)` or mark them `@Public()`.
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
