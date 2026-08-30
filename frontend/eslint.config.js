import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'
import { fileURLToPath } from 'node:url'
import featureBoundaries from './eslint/feature-boundaries.js'

export default defineConfig([
  globalIgnores([
    'dist',
    '.vite',
    'vendor',
    'public/zotero-reader',
    'src/generated',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // `ignoreRestSiblings`: allows the idiom of destructuring a property
      // ONLY to exclude it from `...rest` (e.g. `{ node, ...props }` so as not to
      // leak react-markdown's `node` into the DOM). Doesn't really hide variables
      // unused: only those that have a sibling rest.
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^[A-Z_]',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      // PURGE_NATIVE_DIALOGS directive: native browser dialogs are forbidden.
      // Usa ConfirmModal (confirm), PromptModal (prompt) o toast.error (alert).
      'no-restricted-globals': [
        'error',
        { name: 'confirm', message: 'No usis confirm() natiu — fes servir <ConfirmModal>.' },
        { name: 'prompt', message: 'No usis prompt() natiu — fes servir <PromptModal>.' },
        { name: 'alert', message: 'No usis alert() natiu — fes servir toast.error() (src/lib/toast).' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'confirm', message: 'No usis window.confirm — fes servir <ConfirmModal>.' },
        { object: 'window', property: 'prompt', message: 'No usis window.prompt — fes servir <PromptModal>.' },
        { object: 'window', property: 'alert', message: 'No usis window.alert — fes servir toast.error() (src/lib/toast).' },
      ],
      // React Compiler diagnostics remain visible while historical components
      // are migrated. Core Hooks correctness rules stay at their recommended
      // error severity; these advisory optimization/HMR findings do not block
      // release builds.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^[A-Z_]',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    plugins: { gnosi: { rules: { 'feature-boundaries': featureBoundaries } } },
    rules: {
      'gnosi/feature-boundaries': ['error', { sourceRoot: fileURLToPath(new URL('./src', import.meta.url)) }],
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '(^|/)shared/api(/index([.][^/]+)?)?/?$',
          message: 'Importa l’adaptador del domini concret; no recreïs un agregador global d’API.',
        }],
      }],
    },
  },
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/**/*.test.tsx', 'src/**/*.spec.tsx', 'src/**/__tests__/**'],
    rules: {
      'max-lines-per-function': ['error', {
        max: 300,
        skipBlankLines: true,
        skipComments: true,
        IIFEs: true,
      }],
    },
  },
  {
    files: ['vite.config.js', 'test_*.js', 'tests/**/*.js', 'eslint/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['public/word-addin/**/*.js'],
    languageOptions: {
      globals: {
        Office: 'readonly',
        Word: 'readonly',
      },
    },
  },
])
