import { expect, test } from '@playwright/test';

import {
  installDisposableNetwork,
  seedDisposableBrowser,
} from '../../support/disposable-web.ts';

const PAGE_COUNT = 1_849;

function syntheticTree() {
  return Array.from({ length: PAGE_COUNT }, (_, index) => ({
    id: `synthetic-page-${String(index).padStart(4, '0')}`,
    title: `Synthetic performance note ${String(index).padStart(4, '0')}`,
    last_modified: '2026-01-01T00:00:00Z',
    metadata: index % 13 === 0 ? { favorite: true, icon: '🧠' } : undefined,
  }));
}

test('Knowledge reuses one large synthetic sidebar catalog across a route remount', async ({ context, page }, testInfo) => {
  const pages = syntheticTree();
  const payload = JSON.stringify(pages);
  const payloadBytes = new TextEncoder().encode(payload).byteLength;
  const audit = await installDisposableNetwork(context, { sidebarTree: pages });
  await seedDisposableBrowser(context);
  let treeRequests = 0;
  let fullPageCatalogRequests = 0;

  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/sidebar/tree')) treeRequests += 1;
    if (pathname.endsWith('/knowledge/pages')) fullPageCatalogRequests += 1;
  });
  const response = await page.goto('/@synthetic/knowledge', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await expect(page.locator('.vault-shell__main')).toBeVisible({ timeout: 30_000 });
  await page.getByText(/^WIKI$/i).click();
  await expect(page.getByText('Synthetic performance note 0000', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: /^Correu/ }).click();
  await expect(page.locator('.mail-workspace')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: /^El meu Coneixement/ }).click();
  await expect(page.locator('.vault-shell__main')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Synthetic performance note 0000', { exact: true })).toBeVisible({ timeout: 30_000 });

  await testInfo.attach('knowledge-progressive-load.json', {
    contentType: 'application/json',
    body: JSON.stringify({
      pageCount: PAGE_COUNT,
      payloadBytes,
      avoidedPayloadBytes: payloadBytes * Math.max(0, 2 - treeRequests),
      treeRequests,
      fullPageCatalogRequests,
    }),
  });
  expect(treeRequests).toBe(1);
  expect(fullPageCatalogRequests).toBe(0);
  expect(audit.externalRequests).toEqual([]);
  expect(audit.unknownApiRequests).toEqual([]);
});
