/**
 * Applies pending migrations without starting the API (the API also does this on boot).
 * Only DATABASE_URL is required. Usage (from apps/api): pnpm db:migrate
 */
import { loadDotEnvFile } from '../src/config/load-env';
import { runMigrations } from '../src/db/migrate';

async function main(): Promise<void> {
  loadDotEnvFile();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required but not set (see apps/api/.env.example).');
    process.exit(1);
  }
  await runMigrations(url, { log: (message) => console.warn(message) });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
