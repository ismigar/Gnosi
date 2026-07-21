import { test, expect } from '@playwright/test';

/**
 * Calendar E2E: route loads, FullCalendar mounts.
 */

test.describe('Calendar', () => {
  test('calendar route loads without crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const response = await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);

    await expect(page.locator('#root')).not.toBeEmpty();
    expect(errors, `Page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('FullCalendar grid renders', async ({ page }) => {
    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    const fcRoot = page.locator('.fc, [class*="fc-"]').first();
    await expect(fcRoot).toBeVisible({ timeout: 15_000 });
  });

  test('navigation buttons are present', async ({ page }) => {
    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    // Wait until FullCalendar paints (it owns the nav buttons)
    await expect(page.locator('.fc, [class*="fc-"]').first()).toBeVisible({ timeout: 15_000 });

    const visibleButtons = page.locator('button:visible');
    const buttonCount = await visibleButtons.count();
    expect(buttonCount, 'calendar should expose visible nav buttons').toBeGreaterThan(2);
  });
});
