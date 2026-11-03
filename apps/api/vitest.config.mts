import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // SWC instead of Vite's default transform so Nest decorators and
    // `emitDecoratorMetadata` (constructor injection) work under Vitest.
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        keepClassNames: true,
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Starts (or locates) Postgres + Redis once per run and applies migrations.
    globalSetup: ['./test/setup/global-setup.ts'],
    setupFiles: ['./test/setup/msw.ts'],
    // Integration tests share one database and Redis DB; run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
    restoreMocks: true,
  },
});
