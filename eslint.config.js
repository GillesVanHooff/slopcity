import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Architecture rule (plan.md §3): sim and core stay pure so they can run in a
    // Web Worker and in Node tests.
    files: ['src/sim/**/*.ts', 'src/core/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['three', 'three/*', 'preact', 'preact/*', '@preact/*'],
              message: 'sim/ and core/ must not depend on rendering or UI libraries.',
            },
            {
              group: ['**/render/**', '**/ui/**', '**/input/**'],
              message: 'sim/ and core/ must not import from render/, ui/ or input/.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded Rng from core/rng.ts for determinism.',
        },
      ],
    },
  },
  {
    files: ['*.config.{js,ts}', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
