// ESLint flat config for the Next.js app: the shared preset plus Next.js and React Hooks rules.
import base from '@omero/config/eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  ...base,
  nextPlugin.configs.recommended,
  nextPlugin.configs['core-web-vitals'],
  reactHooks.configs.flat.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
];
