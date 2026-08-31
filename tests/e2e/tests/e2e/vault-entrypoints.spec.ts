import { test, expect } from '@playwright/test';
import { isJsonObject, requireJsonObject } from '../../support/json-value.ts';

const tableId = process.env.GNOSI_TEST_TABLE_ID;
const vaultId = process.env.GNOSI_TEST_VAULT_ID;
const workspaceId = process.env.GNOSI_TEST_WORKSPACE_ID;

for (const entry of ['legacy', 'canonical'] as const) {
  test(`cold ${entry} table entry and reload retain real rows`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    if (!tableId || !vaultId || !workspaceId) {
      test.skip(true, 'Requires an explicitly prepared disposable two-row table and verified context');
      return;
    }
    const response = await page.request.get('/api/vaults', {
      headers: { 'X-Vault-ID': vaultId, 'X-Workspace-ID': workspaceId },
    });
    expect(response.ok()).toBe(true);
    const catalog = requireJsonObject(await response.json());
    const vaults: unknown = catalog.vaults;
    if (!Array.isArray(vaults)) throw new Error('Expected a vault catalog');
    const vault = vaults.filter(isJsonObject).find(candidate => candidate.id === vaultId);
    if (typeof vault?.slug !== 'string') throw new Error('Expected the selected vault slug');
    const canonical = `/@${encodeURIComponent(vault.slug)}/knowledge/table/${encodeURIComponent(tableId)}`;
    const target = entry === 'legacy' ? `/vault/table/${encodeURIComponent(tableId)}` : canonical;
    const errors: string[] = [];
    const failedAssets: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', result => {
      if (['script', 'stylesheet'].includes(result.request().resourceType()) && result.status() >= 400) {
        failedAssets.push(new URL(result.url()).pathname);
      }
    });
    // No warmed shell or navigation clicks: the first document is the deep link.
    const document = await page.goto(target, { waitUntil: 'domcontentloaded' });
    expect(document?.status()).toBe(200);
    for (let visit = 0; visit < 2; visit += 1) {
      await expect(page.locator('td[data-title-cell]').nth(1)).toBeVisible({ timeout: 15_000 });
      await expect(page).toHaveURL(url => url.pathname === canonical);
      const titles = await page.locator('td[data-title-cell]').allTextContents();
      expect(titles.length).toBeGreaterThanOrEqual(2);
      expect(titles.every(title => title.trim().length > 0)).toBe(true);
      if (visit === 0) await page.reload({ waitUntil: 'domcontentloaded' });
    }
    expect(errors).toEqual([]);
    expect(failedAssets).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`${entry}-reloaded-table.png`) });
  });
}
