import { test, expect } from '@playwright/test';

const testVaultId = process.env.GNOSI_TEST_VAULT_ID;

test.describe('Autonomous quality scout', () => {
  test.skip(!testVaultId, 'GNOSI_TEST_VAULT_ID is required for the isolated Proves vault');

  test('uses the isolated vault and detects application-level failures', async ({ page }) => {
    if (!testVaultId) {
      test.skip();
      return;
    }
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((vaultId) => localStorage.setItem('gnosi_active_vault', vaultId), testVaultId);
    await page.goto('/vault', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page.locator('.vault-shell')).toBeVisible({ timeout: 20_000 });
    const activeVault = await page.evaluate(() => localStorage.getItem('gnosi_active_vault'));
    expect(activeVault).toBe(testVaultId);
    expect(errors, `Application errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
