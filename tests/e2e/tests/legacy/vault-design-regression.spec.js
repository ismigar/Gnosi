import { test, expect } from '@playwright/test';
import process from 'node:process';

const vaultPageUrl = process.env.GNOSI_VISUAL_PAGE_URL
  || 'https://localhost:5173/@principal/knowledge/page/74d075a3-eec5-5d71-8d6c-5300b22b5868';

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
];

test.describe('Vault design regression', () => {
  for (const viewport of viewports) {
    for (const colorScheme of ['light', 'dark']) {
      test(`${viewport.name} ${colorScheme}`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport,
          colorScheme,
          ignoreHTTPSErrors: true,
        });
        const page = await context.newPage();
        await page.goto(vaultPageUrl);
        await page.locator('.vault-page-editor').waitFor();

        await expect(page.locator('.vault-page-editor')).toHaveScreenshot(
          `vault-${viewport.name}-${colorScheme}.png`,
          {
            animations: 'disabled',
            mask: [page.locator('.vault-feed')],
          },
        );
        await context.close();
      });
    }
  }
});
