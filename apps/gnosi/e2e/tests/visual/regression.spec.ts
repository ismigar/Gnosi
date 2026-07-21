import { test, expect } from '@playwright/test';

/**
 * Visual regression: pixel-diff against a baseline screenshot.
 *
 * First run creates baselines under tests/visual/regression.spec.ts-snapshots/.
 * Subsequent runs compare; failures dump diffs to test-results/.
 *
 * Update baselines deliberately: `npx playwright test --update-snapshots`.
 *
 * Animations are disabled (config) to keep diffs deterministic.
 */

const ROUTES = [
  { path: '/', name: 'home' },
  { path: '/vault', name: 'vault' },
  { path: '/calendar', name: 'calendar' },
  { path: '/contacts', name: 'contacts' },
];

for (const { path: route, name } of ROUTES) {
  test(`visual: ${name}`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(800);

    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: false,
      mask: [
        page.locator('time, [data-time], .fc-toolbar-title'),
      ],
    });
  });
}
