import { test as setup, expect } from '@playwright/test';
import path from 'path';

/**
 * Auth setup: prepares localStorage state used by authenticated tests.
 *
 * Gnosi has no login screen — auth is header-based via localStorage:
 *   - gnosi_workspace_id  (default: 'personal')
 *   - gnosi_user_email
 *   - gnosi_role
 * The user id is hardcoded to 'ismael-legacy' in src/hooks/use-api.js.
 *
 * This setup runs once before all authenticated tests and caches storageState
 * at tests/.auth/state.json (git-ignored).
 */

const STORAGE_STATE = path.resolve(__dirname, '../.auth/state.json');

setup('seed workspace localStorage', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.evaluate(() => {
    localStorage.setItem('gnosi_workspace_id', 'personal');
    localStorage.setItem('gnosi_user_email', 'ismigar@gmail.com');
    localStorage.setItem('gnosi_role', 'admin');
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });

  await page.context().storageState({ path: STORAGE_STATE });
});
