# Adding a social network

Each network is an adapter that implements the `SocialProvider` interface. Adding one does not touch the domain modules (posts, scheduling, calendar). It touches a small, fixed set of files, listed below. For reference, read the existing adapters: [`x/x.provider.ts`](../../apps/api/src/providers/x/x.provider.ts) and [`linkedin/linkedin.provider.ts`](../../apps/api/src/providers/linkedin/linkedin.provider.ts). Versión en español: [adding-a-provider.md](../es/adding-a-provider.md).

## Rules

- **Official APIs only.** No scraping and no undocumented endpoints.
- **Official docs first.** Put the URLs you used in the adapter header, with a verification date, as X and LinkedIn do.
- **Secrets come from environment variables.** Never hardcode them, and never let them reach error messages or logs.

## Files to change

| File                                                                   | What changes                                                                                                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/providers.ts`                                     | Add the id to `PROVIDER_IDS` and an entry in `PROVIDER_LIMITS`. Without the entry, `Record<ProviderId, ProviderLimits>` does not compile. |
| `packages/shared/test/*.test.ts`                                       | Validation cases for the new limits (for example `validate.test.ts`).                                                                     |
| `apps/api/src/config/env.schema.ts`                                    | Credential variables and their pair in the `superRefine` list.                                                                            |
| `apps/api/src/providers/provider.registry.ts`                          | An entry in `PROVIDER_ENV` and the `register(...)` call in the constructor.                                                               |
| `apps/api/src/providers/<id>/`                                         | `<id>.constants.ts`, `<id>.provider.ts` and `<id>.provider.test.ts`.                                                                      |
| `apps/api/src/db/schema/enums.ts`                                      | Add the id to `PROVIDERS`, then generate the migration.                                                                                   |
| `apps/api/test/msw/handlers/<id>.ts` and `apps/api/test/msw/server.ts` | msw fixtures, registered in `setupServer`.                                                                                                |
| `apps/api/test/integration/providers.int.test.ts`                      | The expected `GET /providers` list, if it changes.                                                                                        |
| `apps/api/openapi.json` and `packages/api-client`                      | Regenerated with `pnpm generate`.                                                                                                         |
| `docs/en/self-hosting.md`, `docs/en/configuration.md`                  | App setup steps and new variables.                                                                                                        |

## 1. Shared limits

`PROVIDER_LIMITS` in `packages/shared/src/providers.ts` feeds the composer and the API validation (`validatePostInput` in `packages/shared/src/text/validate.ts`):

```ts
export const PROVIDER_IDS = ['x', 'linkedin', '<id>'] as const;

// PROVIDER_LIMITS: Readonly<Record<ProviderId, ProviderLimits>>
<id>: {
  maxChars: 1000,
  weightedCounting: false,
  maxImagesPerItem: 4,
  maxImageBytes: 5 * MB,
  allowedMimeTypes: ['image/jpeg', 'image/png'],
  supportsThreads: false,
},
```

`ProviderLimits` fields (`providerLimitsSchema`): `maxChars`, optional `longPostMaxChars`, `weightedCounting` (true only for X-style weighted counting), `maxImagesPerItem`, `maxImageBytes`, `allowedMimeTypes` and `supportsThreads`. Document the source of each value with a comment and the official URL. If the network does not document a value, say so in the comment, as LinkedIn does for its byte limit.

## 2. Environment variables

In `apps/api/src/config/env.schema.ts`, add the variables to `envSchema` as optional, and add the pair to the `superRefine` list so both are set or neither is. Also add them to [`infra/.env.example`](../../infra/.env.example), [`apps/api/.env.example`](../../apps/api/.env.example) and the [configuration reference](configuration.md).

## 3. The adapter

Create `apps/api/src/providers/<id>/<id>.provider.ts` with a class that implements `SocialProvider` ([`provider.types.ts`](../../apps/api/src/providers/provider.types.ts)):

- `id`, `limits` (from `PROVIDER_LIMITS`) and `scopes`.
- `getAuthorizationUrl(state, pkce)`: the consent URL.
- `exchangeCode(code, pkce)` and `refresh(tokens)`: return a `TokenSet`. If refreshing is impossible, throw `ReauthRequired`.
- `getProfile(tokens)`: returns a `ChannelProfile`.
- `uploadMedia(ctx, file)` and `publishItem(ctx, item, replyTo?)`: take a `ProviderContext` (tokens plus account). `item.media` can hold raw files or refs from an earlier upload; use `isRemoteMediaRef` to tell them apart.
- `classifyError(err)`: return `classifyProviderError(err)`, as the existing adapters do.
- `fetchMetrics(ctx, refs)`: optional, only if the network lets the owner token read metrics.

### Error mapping

| Case                                                 | Class in [`provider-errors.ts`](../../apps/api/src/providers/provider-errors.ts) | Effect                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------- |
| 429, 5xx, network or timeout                         | `RetryableProviderError` (accepts `retryAfterMs`)                                | Retried.                            |
| Token rejected (401), or refresh rejected            | `ReauthRequired`                                                                 | Channel moves to `needs_reconnect`. |
| Content rejected, duplicate, permissions, validation | `PermanentProviderError`                                                         | Delivery fails, no retry.           |

Follow the `errorFromResponse` pattern of the existing adapters: read the body with `readJson`, build a stable `code` (for example `DUPLICATE_CONTENT`) and a message without tokens. Trim the upstream detail with `truncateDetail`.

### Helpers

From [`provider-http.ts`](../../apps/api/src/providers/provider-http.ts): `providerFetch` (fetch with a `PROVIDER_TIMEOUT_MS` timeout of 15 s; network errors and timeouts become `RetryableProviderError`), `readJson`, `retryAfterHeaderMs`, `basicAuth`, `parseScopes` and `expiryFromSeconds`. For PKCE, `pkceFromVerifier` in [`oauth-state.store.ts`](../../apps/api/src/providers/oauth-state.store.ts) builds the S256 pair. Put base URLs, scopes and API versions in `<id>.constants.ts`.

## 4. Registration

In [`provider.registry.ts`](../../apps/api/src/providers/provider.registry.ts):

1. Add the variable pair to `PROVIDER_ENV`. `GET /providers` uses it to report what is missing.
2. In the `ProviderRegistry` constructor, register the adapter only when both variables are set:

```ts
if (env.<ID>_CLIENT_ID && env.<ID>_CLIENT_SECRET) {
  this.register(
    new <Name>Provider({
      clientId: env.<ID>_CLIENT_ID,
      clientSecret: env.<ID>_CLIENT_SECRET,
      redirectUri: oauthRedirectUri(env.PUBLIC_BASE_URL, '<id>'),
    }),
  );
}
```

`oauthRedirectUri` builds `${PUBLIC_BASE_URL}/api/v1/channels/<id>/callback`, the URL the owner registers in the network's portal. Without credentials the network reports `configured: false` and cannot be connected.

## 5. Database

`PROVIDERS` in [`apps/api/src/db/schema/enums.ts`](../../apps/api/src/db/schema/enums.ts) defines the Postgres `provider` enum. Add the id and generate the migration:

```sh
pnpm --filter @omero/api db:generate
```

Migrations run when the API starts, before Nest boots, and only move forward. Review the generated SQL in `apps/api/drizzle/` before you commit it.

## 6. Tests

Tests must never reach the real networks. In `apps/api/test/msw/server.ts`, any external request without a handler fails (`onUnhandledFrame`).

1. **Fixtures.** Create `apps/api/test/msw/handlers/<id>.ts` with responses shaped like the real API (as `X_FIXTURES` in `handlers/x.ts`) and a default handler array (`xHandlers`, `linkedinHandlers`).
2. **Registration.** Spread the array into `setupServer(...)` in `apps/api/test/msw/server.ts`.
3. **Unit tests** in `apps/api/src/providers/<id>/<id>.provider.test.ts`: the authorization URL (state, PKCE, scopes), code exchange and refresh, publishing one item and a thread if the network supports it (order and reply ids), and each error case from the table in section 3 (429, 5xx, 401, 403, duplicate, timeout). Use `server.use(http.post(...))` for one-off cases. `x.provider.test.ts` is the reference.
4. **Integration.** If the list of networks changes, update `apps/api/test/integration/providers.int.test.ts`.
5. **Limits.** In `packages/shared/test/`, check that `validatePostInput` enforces `maxChars`, image counts and MIME types for the new network.

API tests need Docker (Testcontainers) or local Postgres and Redis from `pnpm infra:up`. `TEST_DATABASE_URL` and `TEST_REDIS_URL`, when set, take precedence.

## 7. Verification

Run what CI runs, from the repo root:

```sh
pnpm generate        # shared, openapi.json and api-client
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Then update the [self-hosting guide](self-hosting.md) with the steps to create the app in the network's portal, and the [README](../../README.md) if the list of networks changes. _(to confirm: whether `apps/web` needs changes beyond what `GET /providers` provides)_
