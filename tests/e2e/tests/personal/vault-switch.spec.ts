import { expect, test } from '@playwright/test';
import { acceptanceState, contextHeaders } from '../../support/acceptance-state.ts';
import { requireJsonObject } from '../../support/json-value.ts';

test('the real vault selector clears an open primary page before opening secondary content', async ({ page }, testInfo) => {
  const state = acceptanceState();
  await page.addInitScript(() => { localStorage.setItem('i18nextLng', 'en'); });
  const primary = await page.request.get(`/api/vault/pages/${String(state.row_ids[0])}`, { headers: contextHeaders(state) });
  expect(primary.ok()).toBe(true);
  const document = requireJsonObject(await primary.json());
  await page.goto(`/@${state.primary_vault.slug}/knowledge/page/${String(state.row_ids[0])}`);
  await expect(page.locator('.vault-page-title:visible')).toHaveValue(String(document.title));
  await page.getByRole('button', { name: `Vault: ${state.primary_vault.name}`, exact: true }).click();
  await page.locator('[data-vaultmenu]').getByRole('button', { name: state.secondary_vault.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/@${state.secondary_vault.slug}/knowledge$`));
  await expect(page.getByRole('button', { name: `Vault: ${state.secondary_vault.name}`, exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('gnosi_active_vault'))).toBe(state.secondary_vault.id);
  await expect.poll(() => page.locator('.vault-page-title:visible').evaluateAll(elements =>
    elements.map(element => (element as HTMLInputElement).value))).not.toContain(String(document.title));
  const sidebar = page.locator('#vault-navigation');
  const secondary = sidebar.getByText('Secondary vault note', { exact: true }).first();
  if (!await secondary.isVisible()) await sidebar.getByRole('button', { name: /^wiki$/i }).click();
  await secondary.click();
  await expect(page.locator('.vault-page-title:visible')).toHaveValue('Secondary vault note');
  await expect(page.locator('.bn-editor[contenteditable="true"]:visible')).toContainText('belongs only to the secondary vault');
  await expect(page.locator('.vault-shell__main')).not.toContainText(String(document.title));
  const unavailable = await page.request.get(`/api/vault/pages/${String(state.row_ids[0])}`, { headers: contextHeaders(state, state.secondary_vault) });
  expect([403, 404]).toContain(unavailable.status());
  await page.screenshot({ path: testInfo.outputPath('live-vault-switch.png'), fullPage: true });
});
