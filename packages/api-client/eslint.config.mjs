import base from '@omero/config/eslint';

export default [
  ...base,
  {
    // Generated code is checked by the CI staleness diff and by tsc, not by lint rules.
    ignores: ['dist/**', 'src/generated/**'],
  },
];
