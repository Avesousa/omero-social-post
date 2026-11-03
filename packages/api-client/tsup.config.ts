import { defineConfig } from 'tsup';

// ESM only: the consumer is the Next.js web app (bundler resolution). React and
// TanStack Query stay external so the app's single copies are used.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: { compilerOptions: { types: [] } },
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
  external: ['react', '@tanstack/react-query'],
});
