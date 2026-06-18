import { test, expect } from '@playwright/test';

/**
 * AI Chat E2E: floating chat button is visible globally, opens panel, has textarea.
 *
 * The chat is a global component (not a route). Endpoint POST /api/chat is
 * intercepted to avoid burning real LLM credits during tests.
 */

test.describe('AI Chat', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          response: 'Mocked response from Playwright',
          session_id: 'test-session-id',
        }),
      });
    });
  });

  const chatLauncherRegex = /(obrir chat|abrir chat|open chat)/i;

  test('chat launcher button is present on home', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const launcher = page.getByRole('button', { name: chatLauncherRegex });
    await expect(launcher).toBeVisible({ timeout: 10_000 });
  });

  test('chat panel opens with textarea on click', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    await page.getByRole('button', { name: chatLauncherRegex }).click();

    const textarea = page
      .locator('textarea[placeholder*="Escriu"], textarea[placeholder*="message"], textarea[placeholder*="Escribe"]')
      .first();
    await expect(textarea).toBeVisible({ timeout: 5_000 });
  });

  test('typing into chat textarea updates value', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    await page.getByRole('button', { name: chatLauncherRegex }).click();

    const textarea = page
      .locator('textarea[placeholder*="Escriu"], textarea[placeholder*="message"], textarea[placeholder*="Escribe"]')
      .first();
    await expect(textarea).toBeVisible({ timeout: 5_000 });

    await textarea.fill('Test message from Playwright');
    await expect(textarea).toHaveValue('Test message from Playwright');
  });
});
