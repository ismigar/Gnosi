import path from 'node:path';

import { test } from '@playwright/test';

import {
  authenticateForStorage,
  saveAuthStorageState,
  type AuthStorageState,
} from '../../support/auth-playwright.ts';
import { authStorageStatePath } from '../../support/auth-state.ts';

/**
 * Authenticate a pre-provisioned disposable account and cache its real cookie
 * and verified membership at GNOSI_TEST_STORAGE_STATE or, by default,
 * tests/.auth/state.json (git-ignored).
 * No browser or provider calls are needed to prepare this state. The principal
 * validates actual browser login separately against the isolated test backend.
 */

const STORAGE_STATE = authStorageStatePath(
  process.env.GNOSI_TEST_STORAGE_STATE, path.resolve(__dirname, '../..'),
);

const setup = test.extend<{}, { verifiedAuthState: AuthStorageState }>({
  // An automatic worker fixture runs before Playwright's per-test API step
  // recorder. This keeps raw transport errors (which may contain cookies) out
  // of reports as well as traces; the adapter returns only sanitized errors.
  verifiedAuthState: [async ({ playwright }, use, workerInfo) => {
    const state = await authenticateForStorage(
      process.env,
      workerInfo.project.use.baseURL,
      workerInfo.project.use.ignoreHTTPSErrors ?? false,
      (options) => playwright.request.newContext(options),
    );
    await use(state);
  }, { scope: 'worker', auto: true, box: true, timeout: 60_000 }],
});

// File-level options apply before fixture execution, including retries. Do not
// move this protection into the test body or enable diagnostics for this setup.
setup.use({ trace: 'off', video: 'off', screenshot: 'off' });

setup('login and save verified session', async ({ verifiedAuthState }) => {
  await saveAuthStorageState(STORAGE_STATE, verifiedAuthState);
});
