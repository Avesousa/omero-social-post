# Configuration: environment variables

Reference for every environment variable in omero-social-post. It comes from two example files:

- [`infra/.env.example`](../../infra/.env.example): production with Docker Compose. Goes in `/opt/omero/.env`.
- [`apps/api/.env.example`](../../apps/api/.env.example): local development. Goes in `apps/api/.env`.

Variables that appear in only one of the files are marked. Validation lives in [`apps/api/src/config/env.schema.ts`](../../apps/api/src/config/env.schema.ts). If a required variable is missing or a pair is incomplete, the API refuses to start and names the problem.

Versión en español: [configuration.md](../es/configuration.md).

## General rules

- **Required:** without a value, the API does not start.
- **Optional:** the app works without it. The related feature is disabled or a default applies.
- **Pairs:** `X_CLIENT_ID` with `X_CLIENT_SECRET`, `LINKEDIN_CLIENT_ID` with `LINKEDIN_CLIENT_SECRET`, and `TELEGRAM_BOT_TOKEN` with `TELEGRAM_CHAT_ID`. Set both or neither.
- **Secrets:** never commit them. The real `.env` is git-ignored, and gitleaks runs in pre-commit and CI.

## Deployment (Docker Compose only)

| Variable        | Required | Default  | Description                                                                                                                                       |
| --------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OMERO_VERSION` | No       | `latest` | Tag of the `api` and `web` images on GHCR: `latest`, a release (`0.1.0`) or a commit (`sha-<commit>`). Pinning a version makes upgrades explicit. |

## Application

| Variable           | Required             | Default                                                     | Description                                                                                                                                                                                                                                         |
| ------------------ | -------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`         | No                   | `production` in compose; `development` in the local example | `development`, `test` or `production`.                                                                                                                                                                                                              |
| `PORT`             | No                   | `4000`                                                      | Port the API listens on. Compose pins it to `4000`.                                                                                                                                                                                                 |
| `HOST`             | No                   | `0.0.0.0` in containers; `127.0.0.1` in development         | Interface the API binds to. Only in `apps/api/.env.example`; compose sets it.                                                                                                                                                                       |
| `LOG_LEVEL`        | No                   | `info`                                                      | Log level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. Only in `apps/api/.env.example`.                                                                                                                                         |
| `PUBLIC_BASE_URL`  | **Yes**              | None                                                        | Public URL of the app, no trailing slash. In production it is `https://<host>.<tailnet>.ts.net`; locally, `http://localhost:3000`. Used for OAuth callbacks, notification links and the CSRF `Origin` check. It must match the browser URL exactly. |
| `API_INTERNAL_URL` | No (build time only) | `http://api:4000` in the published image                    | URL the web server uses to reach the API. It is baked in by `next build`, so the running web container does not read it. Only needed if you build the web image yourself.                                                                           |

## Database and Redis

| Variable       | Required | Default | Description                                                                                                                                                                                                     |
| -------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | **Yes**  | None    | PostgreSQL connection: `postgres://user:password@host:5432/database`. In compose the host is `postgres`; in development, `127.0.0.1`. If the password contains characters such as `@ : / ? # %`, URL-encode it. |
| `REDIS_URL`    | **Yes**  | None    | Redis 8 connection, used by BullMQ. In compose: `redis://redis:6379/0`. In development: `redis://127.0.0.1:6379/0`.                                                                                             |

## Security

| Variable         | Required | Default | Description                                                                                                                                                                                            |
| ---------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ENCRYPTION_KEY` | **Yes**  | None    | 32 bytes encoded as base64, used to encrypt OAuth tokens at rest (AES-256-GCM). Generate with `openssl rand -base64 32`. Keep a copy off the server: if it is lost, every channel must be reconnected. |

## Media and workers

| Variable          | Required | Default                                          | Description                                                                                                                                           |
| ----------------- | -------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEDIA_DIR`       | No       | `/data/media` in compose; `./media-data` locally | Directory where uploaded images are stored. In Docker it is a volume.                                                                                 |
| `WORKERS_ENABLED` | No       | `true`                                           | Runs the BullMQ workers (publishing, metrics and the reconciler) inside the API process. Set to `false` only if the workers run in another container. |

## Social networks (optional, in pairs)

| Variable                 | Required                                | Default | Description                                                                                                                                                                |
| ------------------------ | --------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `X_CLIENT_ID`            | No (pair with `X_CLIENT_SECRET`)        | Empty   | Client ID of your X app ([developer.x.com](https://developer.x.com)), with OAuth 2.0 enabled. Without this pair, "Connect X" is disabled in Settings → Channels.           |
| `X_CLIENT_SECRET`        | No (pair with `X_CLIENT_ID`)            | Empty   | Client Secret of the same X app.                                                                                                                                           |
| `LINKEDIN_CLIENT_ID`     | No (pair with `LINKEDIN_CLIENT_SECRET`) | Empty   | Client ID of your LinkedIn app, with the products _Share on LinkedIn_ and _Sign In with LinkedIn using OpenID Connect_. Without this pair, "Connect LinkedIn" is disabled. |
| `LINKEDIN_CLIENT_SECRET` | No (pair with `LINKEDIN_CLIENT_ID`)     | Empty   | Client Secret of the same LinkedIn app.                                                                                                                                    |

The callback URLs to register in each portal are built from `PUBLIC_BASE_URL`:

- X: `${PUBLIC_BASE_URL}/api/v1/channels/x/callback`
- LinkedIn: `${PUBLIC_BASE_URL}/api/v1/channels/linkedin/callback`

## Telegram notifications (optional, in pairs)

| Variable             | Required                            | Default | Description                                                                                                                   |
| -------------------- | ----------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | No (pair with `TELEGRAM_CHAT_ID`)   | Empty   | Token of the bot you create with @BotFather.                                                                                  |
| `TELEGRAM_CHAT_ID`   | No (pair with `TELEGRAM_BOT_TOKEN`) | Empty   | Your chat id. Get it with @userinfobot or with the bot's `getUpdates`. Without both variables, notifications stay in the app. |

## PostgreSQL (compose only)

Compose uses these to create the database the first time the Postgres container starts. They must match `DATABASE_URL`.

| Variable            | Required          | Default | Description                                                                                            |
| ------------------- | ----------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `POSTGRES_USER`     | **Yes** (compose) | None    | Database user. Must match `DATABASE_URL`.                                                              |
| `POSTGRES_PASSWORD` | **Yes** (compose) | None    | Password. Must match `DATABASE_URL`. Postgres reads it only when it creates the volume the first time. |
| `POSTGRES_DB`       | **Yes** (compose) | None    | Database name. Must match `DATABASE_URL`.                                                              |
