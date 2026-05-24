import { test, expect } from '@playwright/test';

/**
 * Contacts E2E: route loads, list/empty state visible, "Nou Contacte" button exists.
 */

test.describe('Contacts', () => {
  test('contacts route loads without crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const response = await page.goto('/contacts', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);

    await expect(page.locator('#root')).not.toBeEmpty();
    expect(errors, `Page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('"New Contact" CTA is visible (i18n-agnostic)', async ({ page }) => {
    await page.goto('/contacts', { waitUntil: 'domcontentloaded' });
    const cta = page.getByRole('button', {
      name: /(nou contacte|new contact|nuevo contacto)/i,
    });
    await expect(cta).toBeVisible({ timeout: 10_000 });
  });

  test('contacts page shows list or empty state', async ({ page }) => {
    await page.goto('/contacts', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const main = page.locator('#root');
    await expect(main).toBeVisible();
    const text = (await main.textContent()) ?? '';
    expect(text.length, 'contacts page should render content').toBeGreaterThan(50);
  });
});
