import { test, expect } from '@playwright/test';

/**
 * PageOutline ("title navigator"): the global section navigator mounted in
 * App.jsx scans #page-content-scroll for h1-h3 and lets you jump to them.
 *
 * This test is content-agnostic on purpose: instead of betting on a specific
 * route having >=2 real headings (backend-data dependent), it injects known
 * headings into the real scroll container and exercises the full contract
 * (appear -> open -> list -> jump -> close) against the live app.
 */

const TITLES = ['PW Outline Alpha', 'PW Outline Beta', 'PW Outline Gamma'];

async function injectHeadings(page: import('@playwright/test').Page) {
  await page.evaluate((titles) => {
    const container = document.querySelector('#page-content-scroll');
    if (!container) throw new Error('#page-content-scroll not found');
    const wrap = document.createElement('div');
    wrap.id = 'pw-outline-fixture';
    titles.forEach((titleText, i) => {
      const h = document.createElement(i === 0 ? 'h1' : 'h2');
      h.textContent = titleText;
      wrap.appendChild(h);
      const spacer = document.createElement('div');
      spacer.style.height = '1500px';
      wrap.appendChild(spacer);
    });
    container.appendChild(wrap);
  }, TITLES);
}

test.describe('PageOutline section navigator', () => {
  test('appears, lists injected sections, jumps and closes', async ({ page }) => {
    // PageOutline is gated to content routes (vault / mail / reader); use /reader.
    await page.goto('/reader', { waitUntil: 'domcontentloaded' });

    // The container is part of the App shell and always present.
    await expect(page.locator('#page-content-scroll')).toBeVisible();

    await injectHeadings(page);

    // MutationObserver-driven scan (debounced ~250ms) should reveal the toggle.
    const toggle = page.getByTestId('page-outline-toggle');
    await expect(toggle).toBeVisible();

    await toggle.click();
    const panel = page.getByTestId('page-outline-panel');
    await expect(panel).toBeVisible();

    // Lists exactly the three injected sections.
    const items = panel.getByRole('button', { name: /PW Outline/ });
    await expect(items).toHaveCount(3);
    for (const titleText of TITLES) {
      await expect(panel.getByRole('button', { name: titleText, exact: true })).toBeVisible();
    }

    // Jumping to the last section scrolls its heading near the top of the viewport.
    await panel.getByRole('button', { name: 'PW Outline Gamma', exact: true }).click();
    const gamma = page.getByRole('heading', { name: 'PW Outline Gamma', exact: true });
    await expect
      .poll(async () => (await gamma.boundingBox())?.y ?? Infinity, { timeout: 5_000 })
      .toBeLessThan(200);

    // Escape closes the panel.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(toggle).toBeVisible();
  });

  test('does not appear on excluded routes (Control Center / dashboard)', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#page-content-scroll')).toBeVisible();

    await injectHeadings(page);

    // Give all scans (mount timers + MutationObserver debounce) time to run;
    // the toggle must stay hidden because /dashboard is not an outline route.
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('page-outline-toggle')).toHaveCount(0);
  });
});
