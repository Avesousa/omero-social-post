# Task Plan: Core Publishing

## Metadata
- **Date:** 2026-10-28
- **Branch:** mvp/core-publishing
- **Type:** mvp
- **Tests required:** no (mvp) — Phase 4 still covers the critical paths agreed in the technical spec
- **Total tasks:** 42
- **Parallelizable groups:** 11 waves; widest wave has 8 tasks

## Executive summary
The plan builds the backend and web in parallel on top of a shared contracts package and a generated OpenAPI client, so UI work can start as soon as each backend module lands.
Postgres is the source of truth and BullMQ only executes. The riskiest work is concentrated in the scheduling service, the publish-delivery worker and the X adapter, which get dedicated integration tests with Testcontainers and msw.
Network-specific behaviour lives in adapters behind one interface, and the X/LinkedIn adapters are verified against the current official docs before implementation.
Delivery ends with production images built in CI, a generic VPS bootstrap, Tailscale-only exposure, and an acceptance run on the owner's VPS.

## Phases and tasks

### Phase 0: Setup
- [ ] **T001** — Scaffold the pnpm + Turborepo monorepo
  - Detail: Root package.json with workspaces (apps/*, packages/*), turbo.json pipelines (build, dev, lint, typecheck, test), packages/config with shared tsconfig (strict), eslint flat config and prettier. .nvmrc (Node 22 LTS), .editorconfig, .gitignore. Empty apps/api, apps/web, packages/shared placeholders so the pipeline runs.
  - Done when: `pnpm install && pnpm lint && pnpm typecheck` pass on a clean clone.
  - Dependencies: none
  - Files affected: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `packages/config/**`, `.nvmrc`, `.editorconfig`, `.gitignore`
  - Complexity: M
- [ ] **T002** — Open-source hygiene and secret scanning
  - Detail: README skeleton (es + en summary, project status, link to AiBuild specs), CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, .gitleaks.toml, lefthook pre-commit running gitleaks + lint-staged, .github/dependabot.yml, infra/.env.example listing every variable from the technical spec with comments.
  - Done when: A commit containing a fake `X_CLIENT_SECRET=...` value is blocked by the pre-commit hook; all docs render on GitHub.
  - Dependencies: T001
  - Can parallelize with: T003, T004, T005, T013
  - Files affected: `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.gitleaks.toml`, `lefthook.yml`, `.github/dependabot.yml`, `infra/.env.example`
  - Complexity: S
- [ ] **T003** — Local dev infrastructure (Postgres + Redis)
  - Detail: infra/docker-compose.dev.yml with postgres:17 (shared_buffers=256MB) and redis:8 (appendonly yes, maxmemory 128mb, maxmemory-policy noeviction), healthchecks, named volumes, ports bound to 127.0.0.1 only. Root scripts `pnpm infra:up` / `infra:down`.
  - Done when: `pnpm infra:up` brings both services to healthy; `redis-cli CONFIG GET maxmemory-policy` returns noeviction.
  - Dependencies: T001
  - Can parallelize with: T002, T004, T005, T013
  - Files affected: `infra/docker-compose.dev.yml`, `package.json`
  - Complexity: S
- [ ] **T004** — CI pipeline
  - Detail: GitHub Actions workflow on PR/push: pnpm install with cache, lint, typecheck, test (with service containers or Testcontainers), build, and gitleaks action.
  - Done when: Workflow is green on the branch; a failing lint makes it red.
  - Dependencies: T001
  - Can parallelize with: T002, T003, T005, T013
  - Files affected: `.github/workflows/ci.yml`
  - Complexity: S

### Phase 1: Foundation
- [ ] **T005** — Shared contracts package
  - Detail: packages/shared: provider ids, ProviderLimits per network (chars, images per item, max bytes, mime types, thread support), zod schemas for PostInput, schedule/queue payloads, settings, queue slots, problem+json error shape and error codes (NO_FREE_SLOT, VERSION_CONFLICT, VALIDATION_FAILED, ...). Built as ESM + CJS with types.
  - Done when: Package builds and is importable from both apps/api and apps/web; schemas exported with inferred types.
  - Dependencies: T001
  - Can parallelize with: T002, T003, T004, T013
  - Files affected: `packages/shared/src/**`
  - Complexity: M
- [ ] **T006** — X weighted counter, thread splitter and per-provider validation
  - Detail: In packages/shared: weighted length using twitter-text rules (URLs = 23, wide chars = 2), configurable limit (280 / long posts), auto thread splitter that breaks on paragraph > sentence > word boundaries and never exceeds the limit, `validatePostInput(input, channels, limits)` returning errors keyed by `channels[i].items[j]`, and `containsUrl` for the link-cost note. Unit tests included.
  - Done when: Vitest suite passes with cases for URLs, emoji/CJK, exact-limit boundaries, splitter never producing an over-limit item, and validation error paths.
  - Dependencies: T005
  - Can parallelize with: T007
  - Files affected: `packages/shared/src/text/**`, `packages/shared/test/**`
  - Complexity: M
- [ ] **T007** — NestJS API scaffold
  - Detail: apps/api: Nest app with global prefix /api/v1, config module validating env with zod (fails fast), nestjs-pino with redaction of authorization/cookie/token/password fields, helmet, global problem+json exception filter, nestjs-zod validation pipe, OpenAPI document at /api/v1/openapi.json, /health checking DB and Redis.
  - Done when: `pnpm --filter api dev` starts; GET /api/v1/health returns 200 with db and redis ok; a missing required env var aborts startup with a clear message.
  - Dependencies: T001, T003
  - Can parallelize with: T006
  - Files affected: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/config/**`, `apps/api/src/common/**`, `apps/api/src/health/**`
  - Complexity: M
- [ ] **T008** — Drizzle schema, indexes and migrations
  - Detail: All entities from the technical spec (users, sessions, channels, posts, deliveries, delivery_items, delivery_item_media, media, delivery_attempts, queue_slots, settings, notifications, post_metrics) with enums, FKs, cascades, unique constraints, UUIDv7 ids, timestamptz, and the listed indexes. drizzle-kit config, generated SQL migration, migrator run on boot under a Postgres advisory lock.
  - Done when: Fresh DB migrates on API start; starting two API instances concurrently runs migrations once; `\d posts` shows the (status, scheduled_at) index.
  - Dependencies: T007
  - Can parallelize with: T009, T010, T012
  - Files affected: `apps/api/src/db/schema/**`, `apps/api/drizzle/**`, `apps/api/drizzle.config.ts`, `apps/api/src/db/**`
  - Complexity: M
- [ ] **T009** — Token encryption service
  - Detail: AES-256-GCM encrypt/decrypt with ENCRYPTION_KEY (32 bytes base64), random 12-byte IV, ciphertext format `v1:<iv>:<tag>:<data>` to allow key rotation. Unit tests for round-trip, tampering detection and wrong key.
  - Done when: Tests pass; decrypting a tampered ciphertext throws.
  - Dependencies: T007
  - Can parallelize with: T008, T010, T012
  - Files affected: `apps/api/src/crypto/**`
  - Complexity: S
- [ ] **T010** — Redis and BullMQ infrastructure module
  - Detail: Shared ioredis connection(s), @nestjs/bullmq registration of queues publish, metrics, maintenance, notify; WORKERS_ENABLED flag controlling processor registration; Redis lock helper (SET NX PX) for per-key mutual exclusion; Bull Board mounted at /api/v1/admin/queues (guard wired in the auth task).
  - Done when: API starts with workers on and off; Bull Board lists the four queues; lock helper unit-tested.
  - Dependencies: T007
  - Can parallelize with: T008, T009, T012
  - Files affected: `apps/api/src/queues/**`, `apps/api/src/common/redis-lock.ts`
  - Complexity: S
- [ ] **T011** — Test harness for the API
  - Detail: Vitest config for apps/api, Testcontainers setup for Postgres 17 and Redis 8 (shared per test file), migration on container start, msw server with base handlers for X and LinkedIn endpoints, data factories (channel, post, delivery), helper to run BullMQ jobs to completion synchronously in tests.
  - Done when: A sample integration test inserts a post via factory and runs a no-op job end to end, green in CI.
  - Dependencies: T008, T010
  - Can parallelize with: T014, T015, T016, T017, T022, T038
  - Files affected: `apps/api/vitest.config.ts`, `apps/api/test/**`
  - Complexity: M
- [ ] **T012** — OpenAPI → typed client pipeline
  - Detail: packages/api-client with orval config generating a typed fetch client and TanStack Query hooks from the API's OpenAPI document (exported to a file by a script, no running server needed). Turbo task `generate` and a CI check that fails if the generated client is stale.
  - Done when: `pnpm generate` produces hooks for /health; changing an endpoint without regenerating fails CI.
  - Dependencies: T007, T005
  - Can parallelize with: T008, T009, T010
  - Files affected: `packages/api-client/**`, `apps/api/scripts/export-openapi.ts`, `turbo.json`
  - Complexity: S
- [ ] **T013** — Next.js scaffold and design system
  - Detail: apps/web: Next.js App Router with standalone output, Tailwind + shadcn/ui init, design tokens for a colorful Metricool-inspired palette with its own identity (light and dark), base layout primitives, next-intl with `es` default and `en` catalog scaffolded, rewrites `/api/:path*` → API_INTERNAL_URL, security headers (CSP, X-Frame-Options, Referrer-Policy), TanStack Query provider.
  - Done when: `pnpm --filter web dev` serves a themed placeholder page in Spanish and English via locale switch; `/api/v1/health` proxied through the web returns 200.
  - Dependencies: T001
  - Can parallelize with: T002, T003, T004, T005
  - Files affected: `apps/web/**`
  - Complexity: M

### Phase 2: Core
- [ ] **T014** — Auth module: setup, login, sessions, guards
  - Detail: users/sessions repositories; argon2id hashing (min 12 chars); GET setup-status, POST setup (transaction, 409 if owner exists), login, logout, me; session token 256-bit random with sha256 stored, cookie HttpOnly/Secure/SameSite=Lax, 30-day sliding expiry; global session guard with @Public() opt-out; Origin/Referer check against PUBLIC_BASE_URL on mutating requests; @nestjs/throttler with Redis storage on login (5/15 min per IP+username); protect Bull Board.
  - Done when: Manual run: setup works once then returns 409; protected routes return 401 without cookie; 6th bad login in 15 min returns 429; POST with foreign Origin returns 403.
  - Dependencies: T008, T010
  - Can parallelize with: T011, T015, T016, T017, T022, T038
  - Files affected: `apps/api/src/auth/**`
  - Complexity: L
- [ ] **T015** — Settings and queue slots
  - Detail: Settings service (timezone, missedGraceMinutes default 360) with GET/PUT /settings; queue slots replace-all PUT and GET; `nextFreeSlot(now, tz, slots, takenTimes)` computing in the owner's timezone with date-fns-tz, skipping occupied slots, limited to 30 days, DST-safe; GET /queue-slots/next preview.
  - Done when: Endpoints work; nextFreeSlot unit cases for weekday wrap, occupied slots and a DST transition pass.
  - Dependencies: T008
  - Can parallelize with: T011, T014, T016, T017, T022, T038
  - Files affected: `apps/api/src/settings/**`, `apps/api/src/scheduling/next-free-slot.ts`
  - Complexity: M
- [ ] **T016** — Media module with storage adapter
  - Detail: StorageAdapter interface + LocalDiskStorage (MEDIA_DIR, random keys). POST /media multipart: max 15 MB, magic-byte sniffing with file-type (jpeg/png/webp/static gif), sharp pipeline that strips EXIF/GPS and re-encodes/resizes only above provider limits, sha256 dedupe, dimensions stored. GET /media/:id streams with auth.
  - Done when: Uploading a JPEG with GPS EXIF returns a file without EXIF; a renamed .exe is rejected with 415; a 20 MB file with 413; the same image twice returns the same media id.
  - Dependencies: T008
  - Can parallelize with: T011, T014, T015, T017, T022, T038
  - Files affected: `apps/api/src/media/**`
  - Complexity: M
- [ ] **T017** — Provider framework and OAuth state
  - Detail: SocialProvider interface (technical spec), ProviderRegistry, `configured` detection from env, typed errors (RetryableProviderError, ReauthRequired, PermanentProviderError), PKCE + state generation stored in Redis (10 min TTL) bound to session id, GET /providers.
  - Done when: GET /providers reports configured=false for a provider without env vars; state store rejects unknown or expired state in unit tests.
  - Dependencies: T005, T009, T010
  - Can parallelize with: T011, T014, T015, T016, T022, T038
  - Files affected: `apps/api/src/providers/**`
  - Complexity: M
- [ ] **T018** — X adapter
  - Detail: First verify against current X docs: OAuth 2.0 PKCE scopes (tweet.read tweet.write users.read media.write offline.access), v2 media upload endpoint, POST /2/tweets with reply.in_reply_to_tweet_id, GET /2/users/me, GET /2/tweets?ids= with public_metrics. Implement auth URL, code exchange, refresh with rotation, profile, media upload, publishItem, batched fetchMetrics (≤100 ids), classifyError (429/5xx/network → retryable; 401/invalid_grant → auth; duplicate content/403 policy → permanent). msw fixtures for every call.
  - Done when: Adapter unit tests with msw cover each method and every error class; a manual run against a real X dev app publishes a 2-item thread.
  - Dependencies: T017
  - Can parallelize with: T019, T020, T021, T027, T035, T036, T039
  - Files affected: `apps/api/src/providers/x/**`, `apps/api/test/msw/x.ts`
  - Complexity: L
- [ ] **T019** — LinkedIn adapter
  - Detail: Scopes openid profile w_member_social; GET /v2/userinfo (sub → urn:li:person), POST /rest/posts with current Linkedin-Version header, Images API initializeUpload + PUT, refresh when a refresh token is issued else ReauthRequired at expiry, classifyError. msw fixtures.
  - Done when: Unit tests with msw pass; a manual run publishes a text + image post to the owner's profile.
  - Dependencies: T017
  - Can parallelize with: T018, T020, T021, T027, T035, T036, T039
  - Files affected: `apps/api/src/providers/linkedin/**`, `apps/api/test/msw/linkedin.ts`
  - Complexity: M
- [ ] **T020** — Channels module and token service
  - Detail: GET /channels, GET /channels/:provider/connect (302), GET /channels/:provider/callback (validate state, exchange, fetch profile, upsert by provider+external_id, encrypt tokens, 302 to /settings/channels?connected=), PATCH settings (longPostsEnabled), DELETE (wipe tokens, set disconnected, flag pending deliveries needs_attention). TokenService.getValidTokens(channel): refresh if expiring within 5 min under a per-channel Redis lock, persist rotated tokens, on ReauthRequired set needs_reconnect.
  - Done when: Connecting via the X adapter mock creates one channel; reconnecting updates the same row; concurrent getValidTokens calls trigger exactly one refresh.
  - Dependencies: T014, T017
  - Can parallelize with: T018, T019, T021, T027, T035, T036, T039
  - Files affected: `apps/api/src/channels/**`
  - Complexity: M
- [ ] **T021** — Posts domain service and endpoints
  - Detail: Create/update from PostInput: one delivery per channel, items regenerated from base content (auto-split for X) when not customized, media links per item; provider validation via packages/shared before any scheduling action; optimistic locking on version (409 VERSION_CONFLICT); edit allowed only in draft/scheduled; delete rules; GET /posts range (max 62 days) with deliveries summary in a single joined query; GET /posts/:id full detail; derivePostStatus(deliveries).
  - Done when: Endpoints behave per the API table; a range query for a month issues a constant number of SQL queries regardless of post count (verified via query log).
  - Dependencies: T006, T008, T016
  - Can parallelize with: T018, T019, T020, T027, T035, T036, T039
  - Files affected: `apps/api/src/posts/**`
  - Complexity: L
- [ ] **T022** — Notifications module and Telegram notifier
  - Detail: notifications table service (create, list unread, mark read, read all) with endpoints; NotifyService.notify(type, payload) writes the row and enqueues a `telegram` job (attempts 5, backoff) that calls sendMessage with a preview, network, reason and deep link; silently in-app only when TELEGRAM_* is unset; Spanish message templates.
  - Done when: With a test bot configured, a notify call delivers one Telegram message and one notification row; with no config, only the row is created.
  - Dependencies: T008, T010
  - Can parallelize with: T011, T014, T015, T016, T017, T038
  - Files affected: `apps/api/src/notifications/**`
  - Complexity: S

### Phase 3: Integration
- [ ] **T023** — Scheduling service and publish-post flow
  - Detail: schedule/unschedule/publish-now/queue endpoints with version checks; on change bump version, remove the previous delayed job and add `publish-post` with jobId post:{id}:v{version} and delay to scheduled_at; reject past times (422); queue uses nextFreeSlot with taken times from scheduled posts (422 NO_FREE_SLOT). publish-post processor re-reads the post and no-ops if status ≠ scheduled or version mismatch, then creates a BullMQ flow with one publish-delivery child per pending delivery and sets post status publishing.
  - Done when: Rescheduling twice leaves exactly one delayed job; a stale job runs as a no-op; scheduling in the past returns 422.
  - Dependencies: T015, T021, T010
  - Can parallelize with: T028, T029, T040
  - Files affected: `apps/api/src/scheduling/**`
  - Complexity: L
- [ ] **T024** — publish-delivery worker
  - Detail: Claim delivery with conditional UPDATE (pending|failed → publishing); get valid tokens; upload media per item (cache remote media refs per attempt); publish items sequentially from the first unpublished, persisting remote_id/url right after each; reply chaining for X; record delivery_attempts; classify errors: retryable → throw (attempts 3, exponential 2 min base), auth/permanent → UnrecoverableError + failed; on final failure create notification + Telegram; derive and store post status; for X enqueue metrics jobs at +1h/+24h/+7d. POST /deliveries/:id/retry resumes from the first unpublished item.
  - Done when: With msw: a 3-item thread publishes in order with correct reply ids; a 503 on item 2 retries and resumes at item 2 without duplicating item 1; a 401 marks needs_reconnect without retry and sends one notification.
  - Dependencies: T023, T020, T018, T019, T022
  - Can parallelize with: T030, T031
  - Files affected: `apps/api/src/scheduling/publish-delivery.processor.ts`, `apps/api/src/scheduling/**`
  - Complexity: XL
- [ ] **T025** — Reconciler and token-expiry jobs
  - Detail: Repeatable `reconcile` (every 5 min and on boot): re-enqueue scheduled posts without a pending job; overdue within missedGraceMinutes → publish now; older → mark missed + notify; deliveries stuck in publishing > 20 min → failed/interrupted + notify (no auto retry). Repeatable daily `token-expiry-check`: notify 7 days before LinkedIn expiry, set needs_reconnect at expiry.
  - Done when: Deleting Redis data and restarting re-creates the delayed jobs; an overdue post inside the window publishes, outside it becomes missed.
  - Dependencies: T024
  - Can parallelize with: T026, T034
  - Files affected: `apps/api/src/maintenance/**`
  - Complexity: M
- [ ] **T026** — X metrics worker and manual refresh
  - Detail: fetch-metrics processor grouping all items due in the same run into one batched X call, storing post_metrics rows per checkpoint; POST /posts/:id/metrics/refresh limited to once per 15 min per post; latest metrics included in GET /posts/:id.
  - Done when: Three items due together produce one X request; a second manual refresh within 15 min returns 429.
  - Dependencies: T024, T018
  - Can parallelize with: T025, T034
  - Files affected: `apps/api/src/metrics/**`
  - Complexity: M
- [ ] **T027** — Web: auth screens, app shell and notifications tray
  - Detail: Setup and login pages (redirect logic via setup-status and me), Next middleware redirecting unauthenticated users, app shell with sidebar (Calendario, Nuevo post, Ajustes), user menu with logout, notifications bell with unread badge and tray (polling 30 s while visible), mark read / read all. All strings via next-intl.
  - Done when: Fresh install routes to /setup, then /login, then /calendar; logout returns to /login; a backend notification appears in the tray within 30 s.
  - Dependencies: T013, T012, T014, T022
  - Can parallelize with: T018, T019, T020, T021, T035, T036, T039
  - Files affected: `apps/web/app/(auth)/**`, `apps/web/app/(app)/layout.tsx`, `apps/web/components/shell/**`, `apps/web/middleware.ts`
  - Complexity: M
- [ ] **T028** — Web: settings screens
  - Detail: Channels: cards with avatar/handle/status, Connect buttons (disabled with the missing env var names and a docs link when not configured), reconnect for needs_reconnect, disconnect with confirm, long-posts toggle for X. Queue: weekly slot editor with one-click preset (Mon–Fri 09:00, 18:00) and next-slot preview. General: timezone (default from browser) and grace window.
  - Done when: Connecting X from the UI round-trips through OAuth and shows the channel; queue slots persist and the preview updates.
  - Dependencies: T027, T020, T015
  - Can parallelize with: T023, T029, T040
  - Files affected: `apps/web/app/(app)/settings/**`
  - Complexity: M
- [ ] **T029** — Web: composer editor
  - Detail: Base content textarea, channel multi-select, per-channel tabs (Base / X / LinkedIn) with 'customize' toggle, X thread editor (add, remove, reorder, auto-split helper), live weighted counters and limits from packages/shared, image drop zone uploading to /media with per-network limits, link-cost note on X items with URLs, inline validation errors mapped from API problem details.
  - Done when: Typing over 280 chars in an X item turns its counter red and blocks submit; auto-split produces valid items; images upload and show thumbnails.
  - Dependencies: T027, T006, T021, T016
  - Can parallelize with: T023, T028, T040
  - Files affected: `apps/web/app/(app)/posts/**`, `apps/web/components/composer/**`
  - Complexity: L
- [ ] **T030** — Web: previews and composer actions
  - Detail: Preview cards per network (X thread, LinkedIn post) styled like each network; actions Save draft / Schedule (date-time picker in owner timezone) / Add to queue (shows assigned slot) / Publish now; read-only mode with notice while publishing; version-conflict handling (reload prompt).
  - Done when: Each action produces the expected post status visible in the calendar; scheduling in the past is prevented in the picker and by the API.
  - Dependencies: T029, T023
  - Can parallelize with: T024, T031
  - Files affected: `apps/web/components/composer/**`
  - Complexity: M
- [ ] **T031** — Web: calendar
  - Detail: FullCalendar (MIT plugins: daygrid, timegrid, interaction) with week/month views in owner timezone, Spanish locale, range fetch on navigation, event rendering with network icons, status colors and preview text, needs-attention badge; click empty slot → composer prefilled; drag draft/scheduled post → reschedule with toast + undo, past drops reverted with a message.
  - Done when: Dragging a scheduled post moves it and undo restores it; month and week views show the same posts for overlapping ranges.
  - Dependencies: T027, T021, T023
  - Can parallelize with: T024, T030
  - Files affected: `apps/web/app/(app)/calendar/**`, `apps/web/components/calendar/**`
  - Complexity: L
- [ ] **T032** — Web: post detail view
  - Detail: Detail for published/failed/missed posts: per-delivery status, items with links to the live posts, attempt history with error reasons, Retry delivery / Retry from failed item, metrics panel (latest values + fetched-at + manual refresh) for X.
  - Done when: A failed thread shows which item failed and retrying from the UI resumes it; metrics render after a refresh.
  - Dependencies: T027, T024, T026
  - Can parallelize with: T033, T037, T041
  - Files affected: `apps/web/app/(app)/posts/[id]/**`
  - Complexity: M

### Phase 4: Quality (critical paths)
- [ ] **T033** — Integration tests: scheduling, worker and reconciler
  - Detail: Testcontainers + msw: schedule/reschedule/unschedule with stale-job no-op; double-publish guard under concurrent jobs; retry classification per error type; thread resume from failed item; derived post status (published/partial/failed); reconciler re-enqueue, grace window vs missed, stuck publishing → interrupted.
  - Done when: All listed scenarios covered and green in CI.
  - Dependencies: T011, T024, T025
  - Can parallelize with: T032, T037, T041
  - Files affected: `apps/api/test/scheduling/**`
  - Complexity: L
- [ ] **T034** — Integration tests: channels and tokens
  - Detail: OAuth callback upsert and state rejection; refresh before expiry; serialized refresh under concurrency (X rotation); ReauthRequired → needs_reconnect + in-app + Telegram notification; token encryption at rest (DB column is not plaintext).
  - Done when: Scenarios green in CI.
  - Dependencies: T011, T020, T024
  - Can parallelize with: T025, T026
  - Files affected: `apps/api/test/channels/**`
  - Complexity: M
- [ ] **T035** — Unit tests: queue slots and timezones
  - Detail: nextFreeSlot across weekday wrap, occupied slots, no free slot within 30 days, timezones far from UTC, both DST transitions (spring forward / fall back).
  - Done when: Scenarios green in CI.
  - Dependencies: T011, T015
  - Can parallelize with: T018, T019, T020, T021, T027, T036, T039
  - Files affected: `apps/api/test/settings/**`
  - Complexity: S
- [ ] **T036** — Integration tests: auth and security
  - Detail: Setup only once (including concurrent setup), login throttling, session expiry and sliding renewal, Origin check, logout invalidation, unauthenticated access to every non-public route returns 401 (route table scan).
  - Done when: Scenarios green in CI.
  - Dependencies: T011, T014
  - Can parallelize with: T018, T019, T020, T021, T027, T035, T039
  - Files affected: `apps/api/test/auth/**`
  - Complexity: M
- [ ] **T037** — API contract completeness
  - Detail: Test that the OpenAPI document contains every endpoint from the technical spec with request/response schemas and problem+json errors; regenerate api-client and confirm the web typechecks against it.
  - Done when: Contract test green; `pnpm generate && pnpm typecheck` clean.
  - Dependencies: T012, T024, T026, T025
  - Can parallelize with: T032, T033, T041
  - Files affected: `apps/api/test/contract/**`
  - Complexity: S

### Phase 5: Polish and delivery
- [ ] **T038** — Production images and compose
  - Detail: Multi-stage Dockerfiles for api and web (pnpm deploy / Next standalone, non-root user), infra/docker-compose.yml with postgres, redis, api, web, mem limits per the budget, NODE_OPTIONS heap caps, volumes for DB/Redis/media, healthchecks, ports bound to 127.0.0.1; GitHub Action building and pushing images to GHCR on main and tags.
  - Done when: `docker compose up` on a 1 vCPU / 4 GB machine is healthy and `docker stats` shows total idle memory ≤ 1.2 GB.
  - Dependencies: T007, T013, T008
  - Can parallelize with: T011, T014, T015, T016, T017, T022
  - Files affected: `apps/api/Dockerfile`, `apps/web/Dockerfile`, `infra/docker-compose.yml`, `.github/workflows/release.yml`
  - Complexity: M
- [ ] **T039** — Generic VPS bootstrap and Tailscale exposure
  - Detail: infra/bootstrap.sh (Ubuntu 24.04): create sudo user, SSH key-only, disable root and password login, ufw default deny with no public app ports, unattended-upgrades, Docker, Tailscale install; infra/tailscale/README.md with `tailscale serve` HTTPS setup, MagicDNS/HTTPS certificate enablement, and how PUBLIC_BASE_URL and OAuth redirect URIs use the ts.net hostname; daily pg_dump backup cron script.
  - Done when: Script is idempotent (second run makes no changes) on a fresh Ubuntu 24.04 VM; the app is reachable only via the tailnet hostname.
  - Dependencies: T038
  - Can parallelize with: T018, T019, T020, T021, T027, T035, T036
  - Files affected: `infra/bootstrap.sh`, `infra/backup.sh`, `infra/tailscale/README.md`
  - Complexity: M
- [ ] **T040** — Self-hosting documentation
  - Detail: docs/ (es + en): creating the X developer app (pay-per-use credits, callback URL, scopes), LinkedIn app (Share on LinkedIn + OpenID Connect products, required company page), Telegram bot + chat id, env var reference, upgrade and backup/restore, architecture overview with the diagram, how to add a provider adapter.
  - Done when: A reader can go from zero to a connected X channel following only the docs (dry run by the owner).
  - Dependencies: T018, T019, T022, T039
  - Can parallelize with: T023, T028, T029
  - Files affected: `docs/**`, `README.md`
  - Complexity: M
- [ ] **T041** — Observability and cleanup
  - Detail: Structured logs in workers with post/delivery/job ids and attempt numbers, redaction verified, Bull Board reachable only when logged in, TODO/debt notes collected into AiBuild notes, dead code removal, lint clean.
  - Done when: A failed publish produces a single log trail searchable by post id; no secrets in logs during a full test run.
  - Dependencies: T024, T025, T026
  - Can parallelize with: T032, T033, T037
  - Files affected: `apps/api/src/**`
  - Complexity: S
- [ ] **T042** — Acceptance run on the VPS
  - Detail: Deploy to the owner's VPS behind Tailscale, connect real X and LinkedIn accounts and walk through every acceptance criterion in the functional spec, recording results in AiBuild notes.
  - Done when: All 16 acceptance criteria checked off with evidence (screens or links).
  - Dependencies: T028, T030, T031, T032, T033, T034, T035, T036, T037, T039, T040, T041
  - Files affected: `AiBuild/mvp/core-publishing/WIP/acceptance.md`
  - Complexity: M

## Dependency map
Critical path (longest chain):
```
T001 (monorepo) → T003 (devinfra) → T007 (api-scaffold) → T008 (db) → T016 (media) → T021 (posts) → T023 (scheduling) → T024 (worker) → T026 (metrics) → T032 (web-post-detail) → T042 (acceptance)
```

Full dependency edges:
```
T001 → T002
T001 → T003
T001 → T004
T001 → T005
T005 → T006
T001, T003 → T007
T007 → T008
T007 → T009
T007 → T010
T008, T010 → T011
T007, T005 → T012
T001 → T013
T008, T010 → T014
T008 → T015
T008 → T016
T005, T009, T010 → T017
T017 → T018
T017 → T019
T014, T017 → T020
T006, T008, T016 → T021
T008, T010 → T022
T015, T021, T010 → T023
T023, T020, T018, T019, T022 → T024
T024 → T025
T024, T018 → T026
T013, T012, T014, T022 → T027
T027, T020, T015 → T028
T027, T006, T021, T016 → T029
T029, T023 → T030
T027, T021, T023 → T031
T027, T024, T026 → T032
T011, T024, T025 → T033
T011, T020, T024 → T034
T011, T015 → T035
T011, T014 → T036
T012, T024, T026, T025 → T037
T007, T013, T008 → T038
T038 → T039
T018, T019, T022, T039 → T040
T024, T025, T026 → T041
T028, T030, T031, T032, T033, T034, T035, T036, T037, T039, T040, T041 → T042
```

## Parallelizable groups
- **Wave 1** (after start): T001 monorepo
- **Wave 2** (after wave 1): T002 hygiene, T003 devinfra, T004 ci, T005 shared-contracts, T013 web-scaffold
- **Wave 3** (after wave 2): T006 shared-text, T007 api-scaffold
- **Wave 4** (after wave 3): T008 db, T009 crypto, T010 queues, T012 api-client
- **Wave 5** (after wave 4): T011 harness, T014 auth, T015 settings-slots, T016 media, T017 providers, T022 notifications, T038 prod-infra
- **Wave 6** (after wave 5): T018 x-adapter, T019 linkedin-adapter, T020 channels, T021 posts, T027 web-shell, T035 test-slots, T036 test-auth, T039 vps
- **Wave 7** (after wave 6): T023 scheduling, T028 web-settings, T029 web-composer, T040 docs
- **Wave 8** (after wave 7): T024 worker, T030 web-composer-actions, T031 web-calendar
- **Wave 9** (after wave 8): T025 reconciler, T026 metrics, T034 test-tokens
- **Wave 10** (after wave 9): T032 web-post-detail, T033 test-scheduling, T037 contract-check, T041 observability
- **Wave 11** (after wave 10): T042 acceptance

Suggested agent lanes once Phase 1 is done: **backend-core** (auth, settings, media, posts), **providers** (framework, X, LinkedIn, channels), **web** (shell, settings, composer, calendar) and **infra/docs** (prod images, VPS, docs).

## Risks and mitigations
| Risk | Probability | Mitigation |
|------|------------|------------|
| X API details (scopes, media upload, pricing) changed since the spec | Medium | T018 starts by checking the current docs; X logic is isolated in its adapter and covered by msw fixtures |
| X requires buying pay-per-use credits before any real post | High | The owner loads a few dollars of credits before the manual run in the X adapter task; development runs on msw mocks |
| A LinkedIn developer app must be associated with a LinkedIn Company Page | High | Create a minimal page for the project (doubles as branding); documented in the self-hosting docs |
| Double publishing after crashes or Redis loss | Medium | Conditional claim update, persisted remote ids per item, stuck deliveries marked interrupted instead of retried |
| Timezone/DST bugs in queue slots and calendar | Medium | All storage in UTC, date-fns-tz everywhere, dedicated DST tests |
| Memory pressure on 1 vCPU / 4 GB | Low | Heap caps, Redis maxmemory, compose mem limits, measured in the prod-infra task |
| Tailscale HTTPS not enabled in the tailnet | Low | Steps in the Tailscale README (MagicDNS + HTTPS certificates) |
| GitHub push blocked from the agent session | High (today) | The owner installs the Claude GitHub App on the repo; until then commits stay local |
| Copying Postiz code by accident | Low | Reference only; contributors note any borrowed idea in PRs; both projects are AGPL-3.0 if attribution is ever needed |

## Complexity summary
| Task | S/M/L/XL | Reason |
|------|----------|--------|
| T014 Auth module: setup, login, sessions, guards | L | Security-sensitive: sessions, CSRF, throttling |
| T018 X adapter | L | OAuth rotation, media upload, threads, error taxonomy, API volatility |
| T021 Posts domain service and endpoints | L | Delivery/item generation, validation, locking and efficient range queries |
| T023 Scheduling service and publish-post flow | L | Job versioning, flows and stale-job safety |
| T024 publish-delivery worker | XL | Concurrency, retries, resume, notifications and metrics fan-out in one processor |
| T029 Web: composer editor | L | Most interactive UI: threads, counters, uploads, error mapping |
| T031 Web: calendar | L | Drag & drop, timezones, undo |
| T033 Integration tests: scheduling, worker and reconciler | L | Many concurrent and failure scenarios against real Postgres/Redis |

Totals: S=10, M=24, L=7, XL=1.
