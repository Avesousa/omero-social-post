import { defineConfig } from 'tsup';

// Dual build: CommonJS for the NestJS API (moduleResolution Node10) and ESM for Next.js.
// Without "type": "module" tsup emits index.js (CJS) + index.mjs (ESM) and matching .d.ts / .d.mts.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: { compilerOptions: { types: [] } },
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
});
