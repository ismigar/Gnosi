import { test, expect } from '@playwright/test';

/**
 * Vault E2E: sidebar loads, can navigate to a page.
 *
 * Selectors are deliberately conservative since the codebase has no data-testid yet.
 * When the UI stabilizes, prefer adding data-testid="vault-sidebar" / "vault-page-tree-item".
 */

test.describe('Vault', () => {
  test('vault route loads without crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const response = await page.goto('/vault', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);

    await expect(page.locator('#root')).not.toBeEmpty();
    expect(errors, `Page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('app sidebar is rendered with navigation items', async ({ page }) => {
    await page.goto('/vault', { waitUntil: 'domcontentloaded' });
    const sidebarItems = page.locator('.app-sidebar__item');
    await expect(sidebarItems.first()).toBeVisible({ timeout: 10_000 });

    const count = await sidebarItems.count();
    expect(count, 'sidebar should have at least one item').toBeGreaterThan(0);
  });

  test('vault sidebar tree renders (or shows empty state)', async ({ page }) => {
    await page.goto('/vault', { waitUntil: 'domcontentloaded' });

    const main = page.locator('#root');
    await expect(main).toBeVisible();

    // expect.poll (not a one-shot evaluate): with 2 workers, Vite's transform
    // dev can take >10s to serve the whole module graph, and the single-shot
    // check still saw «Carregant…» — false positive seen on 2026-06-10.
    await expect
      .poll(async () => ((await main.textContent()) ?? '').length, {
        message: 'vault should render some content (tree or empty state)',
        timeout: 20_000,
      })
      .toBeGreaterThan(50);
  });
});
