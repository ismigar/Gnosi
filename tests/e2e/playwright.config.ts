import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { authStorageStatePath } from './support/auth-state.ts';

// Replicates the vite.config detection (frontend/vite.config.js): the dev server
// serves HTTPS if the mkcert certs exist at frontend/certs/, otherwise HTTP.
// So local-with-certs uses https and CI/other-Mac (without certs) uses http, without
// break either of them. Manual override: GNOSI_BASE_URL. See frontend_https_dev.
const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const CERT_FILE = path.join(CONFIG_DIR, '..', '..', 'frontend', 'certs', 'localhost.pem');
const DEFAULT_BASE_URL = fs.existsSync(CERT_FILE)
  ? 'https://localhost:5173'
  : 'http://localhost:5173';

/**
 * Playwright config for Gnosi E2E tests.
 *
 * Architecture:
 * - Frontend/backend are started separately in a chosen disposable environment.
 * - Tests connect to the configured frontend over HTTP or local mkcert HTTPS.
 * - We do NOT start a webServer here — anti-ghosting (see environment_integrity.md):
 *   if 5173 is not up, tests fail by design instead of spinning a second instance.
 * - Docker remains a supported deployment target, but it is not the local fallback.
 *
 * Projects:
 * - setup: verifies password login, an HttpOnly cookie and auth/me membership;
 *   caches the real session at .auth/state.json. Its file-level setup.use disables
 *   trace/video/screenshots before authentication, including retries.
 * - chromium-anon: smoke tests that don't need auth.
 * - disposable-web: synthetic API/browser acceptance with external networking blocked.
 * - chromium-auth: feature tests that need workspace context.
 */

const STORAGE_STATE = authStorageStatePath(process.env.GNOSI_TEST_STORAGE_STATE, CONFIG_DIR);

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
      use: { trace: 'off', video: 'off', screenshot: 'off' },
    },
    {
      name: 'chromium-anon',
      testDir: './tests/anon',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'disposable-web',
      testDir: './tests/disposable',
      fullyParallel: false,
      retries: 0,
      workers: 1,
      use: {
        ...devices['Desktop Chrome'],
        trace: 'off',
        video: 'off',
        screenshot: 'only-on-failure',
      },
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
      name: 'accessibility',
      testDir: './tests/accessibility',
      fullyParallel: false,
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
