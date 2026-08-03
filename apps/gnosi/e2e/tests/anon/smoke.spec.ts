import { test, expect } from '@playwright/test';

/**
 * Smoke test: minimum guarantee that the frontend serves the app shell
 * without console errors or white screen.
 *
 * This replaces the manual QA Protocol step 2 (Runtime Verification).
 */

test.describe('Gnosi frontend smoke', () => {
  test('home loads and returns 2xx', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response, 'navigation response should exist').not.toBeNull();
    expect(response!.status(), 'home should respond 2xx').toBeLessThan(400);
  });

  test('renders root #root element with content', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const root = page.locator('#root');
    await expect(root).toBeVisible();
    await expect(root).not.toBeEmpty();
  });

  test('document title is set (no white screen)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/.+/);
  });

  test('no critical console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore known noise: third-party warnings, devtools downloads
        if (
          text.includes('React DevTools') ||
          text.includes('Download the React DevTools') ||
          text.includes('Failed to load resource: the server responded with a status of 404')
        ) {
          return;
        }
        errors.push(text);
      }
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {
      // networkidle may never fire if the app keeps polling — that's fine
    });

    expect(errors, `Console errors detected:\n${errors.join('\n')}`).toEqual([]);
  });

  test('no native dialogs (window.confirm / window.alert) trigger on load', async ({ page }) => {
    let dialogTriggered = false;
    page.on('dialog', async (dialog) => {
      dialogTriggered = true;
      await dialog.dismiss();
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    expect(dialogTriggered, 'No native dialog should appear on load').toBe(false);
  });
});
