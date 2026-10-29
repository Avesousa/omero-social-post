import base from '@omero/config/eslint';

export default [
  ...base,
  {
    ignores: ['dist/**', 'drizzle/**', 'coverage/**'],
  },
  {
    // Nest resolves constructor injection from emitted decorator metadata.
    // Telling the parser about these flags makes `consistent-type-imports`
    // keep value imports for classes referenced in decorated signatures.
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
      },
    },
  },
];
