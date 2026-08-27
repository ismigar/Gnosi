import { expect, test } from '@playwright/test';
import process from 'node:process';

const baseUrl = process.env.GNOSI_E2E_BASE_URL || 'https://localhost:5173';
const knownPageId = process.env.GNOSI_E2E_PAGE_ID || '74d075a3-eec5-5d71-8d6c-5300b22b5868';

test.describe('Vault-scoped routing', () => {
  test.setTimeout(120_000);
  test.use({ ignoreHTTPSErrors: true });

  test('redirects a legacy page URL and uses canonical vault APIs', async ({ page }, testInfo) => {
    const apiRequests = [];
    await page.route('**/api/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/vaults') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            vaults: [{
              id: 'vault-principal',
              name: 'Principal',
              slug: 'principal',
              path: '/tmp/principal',
              active: true,
            }],
            active_path: '/tmp/principal',
          }),
        });
        return;
      }
      if (pathname === '/api/health') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok', gnosi_mode: 'personal', require_auth: false }),
        });
        return;
      }
      if (pathname === '/api/auth/me') {
        await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.fulfill({ contentType: 'application/json', body: '[]' });
    });
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) apiRequests.push(url.pathname);
    });

    await page.goto(`${baseUrl}/vault/page/${knownPageId}`, {
      waitUntil: 'commit',
      timeout: 60_000,
    });

    await expect.poll(
      () => apiRequests.includes('/api/vaults'),
      { timeout: 60_000 },
    ).toBe(true);
    await expect(page).toHaveURL(
      `${baseUrl}/@principal/knowledge/page/${knownPageId}`,
      { timeout: 15_000 },
    );
    await expect(page.locator('body')).not.toBeEmpty();
    await page.evaluate(() => fetch('/api/vault/pages?limit=1'));
    expect(apiRequests).toContain('/api/v1/vaults/principal/knowledge/pages');
    expect(apiRequests.some((pathname) => pathname.startsWith('/api/vault/pages'))).toBe(false);

    await page.screenshot({ path: testInfo.outputPath('canonical-vault-page.png'), fullPage: true });
  });
});
