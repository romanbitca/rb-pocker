// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/dist/',
    '**/node_modules/',
    '**/coverage/',
    '**/playwright-report/',
    '**/test-results/',
    '.claude/',
    '.loop/',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // The game: runs in the browser.
    files: ['apps/web/src/**', 'apps/web/tests/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    // The server, config files and scripts: run in Node.
    files: ['apps/server/**', '**/*.config.{js,ts}', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
);
