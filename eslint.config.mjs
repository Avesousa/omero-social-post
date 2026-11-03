import base from '@omero/config/eslint';

export default [
  ...base,
  {
    ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/coverage/**', 'AiBuild/**'],
  },
];
