import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` only diffs the schema against drizzle/meta, so no database
// connection is needed. Migrations are applied by the API on boot (src/db/migrate.ts)
// or with `pnpm --filter @omero/api db:migrate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://omero:omero@127.0.0.1:5432/omero',
  },
});
