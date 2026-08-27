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
  setup.setTimeout(60_000);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const testVaultId = process.env.GNOSI_TEST_VAULT_ID;

  await page.evaluate((vaultId) => {
    localStorage.setItem('gnosi_workspace_id', 'personal');
    localStorage.setItem('gnosi_user_email', 'ismigar@gmail.com');
    localStorage.setItem('gnosi_role', 'admin');
    localStorage.setItem('i18nextLng', 'ca');
    if (vaultId) localStorage.setItem('gnosi_active_vault', vaultId);
  }, testVaultId);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });

  const releaseNotesClose = page.getByRole('button', { name: /close release notes|tanca|cerrar|fermer/i });
  await releaseNotesClose.waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => releaseNotesClose.click())
    .catch(() => {});

  await page.context().storageState({ path: STORAGE_STATE });
});
