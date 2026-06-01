import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Replica la detecció de vite.config (frontend/vite.config.js): el dev server
// serveix HTTPS si existeixen els certs mkcert a frontend/certs/, si no HTTP.
// Així local-amb-certs usa https i CI/altra-Mac (sense certs) usa http, sense
// trencar cap dels dos. Override manual: GNOSI_BASE_URL. Vegeu frontend_https_dev.
const CERT_FILE = path.join(__dirname, '..', 'frontend', 'certs', 'localhost.pem');
const DEFAULT_BASE_URL = fs.existsSync(CERT_FILE)
  ? 'https://localhost:5173'
  : 'http://localhost:5173';

/**
 * Playwright config for Gnosi E2E tests.
 *
 * Architecture:
 * - Frontend runs in Docker (gnosi_frontend) on localhost:5173.
 * - Tests run on the host (macOS) and connect over HTTP.
 * - We do NOT start a webServer here — anti-ghosting (see environment_integrity.md):
 *   if 5173 is not up, tests fail by design instead of spinning a second instance.
 *
 * Projects:
 * - setup: prepares localStorage state for authenticated runs (cached at .auth/state.json).
 * - chromium-anon: smoke tests that don't need auth.
 * - chromium-auth: feature tests that need workspace context.
 */

const STORAGE_STATE = 'tests/.auth/state.json';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Vite dev server saturates with many parallel browser contexts.
  // Cap at 2 locally; CI uses sharding via --shard so 1 worker per shard is fine.
  workers: process.env.CI ? 1 : 2,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: process.env.GNOSI_BASE_URL || DEFAULT_BASE_URL,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 5_000,
    navigationTimeout: 30_000,
  },

  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    },
  },

  timeout: 30_000,

  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'chromium-anon',
      testDir: './tests/anon',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-auth',
      testDir: './tests/e2e',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE,
      },
      dependencies: ['setup'],
    },
    {
      name: 'visual',
      testDir: './tests/visual',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE,
        viewport: { width: 1280, height: 720 },
      },
      dependencies: ['setup'],
    },
  ],
});
