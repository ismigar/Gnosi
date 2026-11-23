import { expect, test } from '@playwright/test';
import { acceptanceState, contextHeaders } from '../../support/acceptance-state.ts';
import { requireJsonObject } from '../../support/json-value.ts';

test('a personal canvas keeps a resized and reordered block after reopening', async ({ page }) => {
  const state = acceptanceState();
  const endpoint = '/api/vault/home-canvas';
  const headers = contextHeaders(state);
  const readLayout = async () => {
    const response = await page.request.get(endpoint, { headers });
    expect(response.ok()).toBe(true);
    return requireJsonObject(await response.json());
  };
  const original = await readLayout();
  try {
    await page.addInitScript(() => { localStorage.setItem('i18nextLng', 'en'); });
    await page.goto('/@' + state.primary_vault.slug + '/knowledge');
    await expect(page.locator('.vault-shell__main')).toBeVisible();
    await page.goto('/');
    const home = page.getByTestId('home-canvas');
    await expect(home).toBeVisible();
    await page.getByTestId('home-edit').click();
    await home.locator('button[aria-controls="home-block-catalog"]').click();
    await home.locator('[data-add-kind="bookmarks"]').click();
    const card = home.locator('[data-home-block="bookmarks"]');
    await card.locator('.home-block__tools select').selectOption('2');
    await card.getByRole('button', { name: /earlier/i }).click();
    const blocks = home.locator('[data-home-block]');
    const order = await blocks.evaluateAll(tiles => tiles.map(tile => tile.getAttribute('data-home-block')));
    await page.getByTestId('home-edit').click();
    await expect(home.locator('.home-block__tools')).toHaveCount(0);
    await page.reload();
    await expect(card).toHaveAttribute('data-width', '2');
    expect(await blocks.evaluateAll(tiles => tiles.map(tile => tile.getAttribute('data-home-block')))).toEqual(order);
    const other = await page.request.get(endpoint, { headers: contextHeaders(state, state.secondary_vault) });
    expect(other.ok()).toBe(true);
    expect(requireJsonObject(await other.json()).blocks).toBeNull();
  } finally {
    const current = await readLayout();
    const restored = await page.request.put(endpoint, { headers, data: { ...original, revision: current.revision } });
    expect(restored.ok()).toBe(true);
  }
});
