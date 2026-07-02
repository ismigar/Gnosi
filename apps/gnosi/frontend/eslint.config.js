import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
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
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // Directiva PURGE_NATIVE_DIALOGS: prohibits els diàlegs natius del navegador.
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
    },
  },
])
