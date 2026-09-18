// Correctness-only lint. Style is not enforced; what IS enforced are the
// classes of bug that a build cannot catch and that took the app down in
// production: a `const` read before its line (TDZ), a name that is never
// defined, a constant reassigned. `npm run lint` runs in CI before the build.
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'release/**', 'node_modules/**', 'server/**/node_modules/**'] },
  {
    files: ['src/**/*.{js,jsx}', 'electron/**/*.{js,cjs,mjs}', 'scripts/**/*.mjs', 'server/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, React: 'readonly' },
    },
    rules: {
      'no-use-before-define': ['error', { functions: false, classes: false, variables: true, allowNamedExports: true }],
      'no-undef': 'error',
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-dupe-else-if': 'error',
      'no-unreachable': 'error',
      'no-self-assign': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-unsafe-negation': 'error',
      'valid-typeof': 'error',
      'no-import-assign': 'error',
      'no-func-assign': 'error',
      'no-setter-return': 'error',
      'use-isnan': 'error',
    },
  },
  { files: ['electron/**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },
];
