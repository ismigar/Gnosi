import { defineConfig, devices } from '@playwright/test';

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
    baseURL: process.env.GNOSI_BASE_URL || 'http://localhost:5173',
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
