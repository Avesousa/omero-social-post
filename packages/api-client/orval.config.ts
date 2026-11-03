import { defineConfig } from 'orval';

/**
 * Generates the typed client from the API's OpenAPI document.
 * Regenerate with `pnpm generate` from the repo root (exports the document first).
 */
export default defineConfig({
  api: {
    input: {
      target: '../../apps/api/openapi.json',
    },
    output: {
      // One file per OpenAPI tag plus a shared `model/` folder for the schemas.
      mode: 'tags-split',
      target: './src/generated/endpoints',
      schemas: './src/generated/model',
      indexFiles: true,
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      override: {
        mutator: {
          path: './src/fetcher.ts',
          name: 'apiFetch',
        },
        // Request functions resolve to the response body; errors are thrown as ApiError.
        fetch: {
          includeHttpResponseReturnType: false,
        },
        // Defaults: GET operations become queries, everything else mutations.
        query: {
          version: 5,
          signal: true,
          shouldExportKeys: true,
        },
      },
    },
  },
});
