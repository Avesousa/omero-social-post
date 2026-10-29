# @omero/api-client

Typed fetch client and TanStack Query v5 hooks for the omero-social-post API, generated with [orval](https://orval.dev) from the API's OpenAPI document.

## Regenerating

From the repo root:

```sh
pnpm generate
```

This runs two Turborepo tasks in order:

1. `@omero/api#generate`: builds the API and writes `apps/api/openapi.json` (Nest preview mode, so no Postgres or Redis needed).
2. `@omero/api-client#generate`: runs orval on that file and rewrites `src/generated/`.

Commit both `apps/api/openapi.json` and `src/generated/` together with the API change. CI regenerates them and fails if the result differs from what is committed, so a changed endpoint without a regenerated client is caught.

Then build the package (`pnpm --filter @omero/api-client build`, or just `pnpm build`). The web app imports the built `dist/` output.

Never edit `src/generated/` by hand. It is wiped on every run. Change the API (controllers and nestjs-zod DTOs) or `orval.config.ts` instead.

## Layout

| Path                            | What it is                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `orval.config.ts`               | Generator config: `tags-split` mode, `react-query` client over `fetch`, custom mutator.         |
| `src/fetcher.ts`                | The mutator (`apiFetch`): relative URLs, `credentials: 'include'`, JSON parsing, throws errors. |
| `src/errors.ts`                 | `ApiError` (problem+json body: `status`, `code`, `detail`, `errors[]`) and `isApiError`.        |
| `src/generated/endpoints/<tag>` | One file per OpenAPI tag: request functions, query keys, query options and hooks.               |
| `src/generated/model`           | Request and response types (plus `as const` enum objects).                                      |
| `src/index.ts`                  | Public entry point; re-exports all of the above.                                                |

## Usage (web, client components)

URLs are relative (`/api/v1/...`): the browser calls the web origin and Next.js rewrites `/api/*` to the API, so the session cookie stays first-party. Use the hooks and functions from client components (`'use client'`). Server code has no origin to resolve the relative URLs against.

```tsx
'use client';

import { isApiError, useHealthControllerCheck } from '@omero/api-client';

export function ApiStatus() {
  const { data, error, isPending } = useHealthControllerCheck({
    query: { refetchInterval: 30_000 },
  });

  if (isPending) return <span>…</span>;
  // `error` is typed as ApiError: branch on the stable `code`, show `detail`.
  if (error)
    return (
      <span>
        {error.code}: {error.detail ?? error.message}
      </span>
    );
  return <span>{data.status}</span>;
}
```

Mutations (POST/PUT/PATCH/DELETE operations) get `use<OperationId>` hooks built on `useMutation`. Validation errors carry field paths like `channels[0].items[1].text`:

```ts
try {
  await mutation.mutateAsync({ data: payload });
} catch (err) {
  if (isApiError(err) && err.status === 422) {
    for (const issue of err.errors) form.setError(issue.path, { message: issue.message });
  } else if (isApiError(err) && err.code === 'VERSION_CONFLICT') {
    // reload and ask the user to merge
  } else {
    throw err;
  }
}
```

Query keys are exported too (`getHealthControllerCheckQueryKey()`), so you can call `queryClient.invalidateQueries({ queryKey })` after a mutation.

Non-2xx responses always throw `ApiError`. When the body is not problem+json (for example the 503 payload of `/health`, or a proxy error page), `error.problem` is `undefined`, `error.code` is `HTTP_<status>`, and the raw parsed body is in `error.body`.
