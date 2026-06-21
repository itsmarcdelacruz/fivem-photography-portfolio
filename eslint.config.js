import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'worker/node_modules/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', '*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['worker/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.worker, ...globals.node }
    }
  },
  {
    files: ['*.config.js', 'vite.config.js', 'vitest.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node }
    }
  },
  {
    files: ['**/*.test.js', 'worker/test/**/*.js', 'test/**/*.js'],
    languageOptions: {
      globals: { ...globals.node }
    }
  }
];
