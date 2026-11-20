import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { installDisposableNetwork, seedDisposableBrowser } from '../../support/disposable-web.ts';
import { requireJsonObject } from '../../support/json-value.ts';

// Match the hostname of app://gnosi in Chromium. A non-loopback, secure origin
// exercises production-only SDK behavior. All frontend bytes come from disk.
const ORIGIN = 'https://gnosi';
const BUNDLE = fileURLToPath(new URL('../../../../frontend/dist', import.meta.url));
const DRAWING = '/api/vault/drawings/synthetic-drawing';

test.use({ serviceWorkers: 'block' });

test('the production drawing editor can draw, save and reopen after startup', async ({ context, page }) => {
  test.setTimeout(60_000);
  const audit = await installDisposableNetwork(context, { syntheticApiOrigin: ORIGIN });
  await seedDisposableBrowser(context);
  let saved: Record<string, unknown> = {};
  await page.route(`${ORIGIN}/**`, async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === DRAWING) {
      if (route.request().method() === 'PUT') {
        saved = requireJsonObject(requireJsonObject(route.request().postDataJSON()).data);
        return route.fulfill({ json: { id: 'synthetic-drawing', status: 'success' } });
      }
      return route.fulfill({ json: saved });
    }
    if (pathname === '/api/vault/handwriting/status') {
      return route.fulfill({ json: { available: false, loaded: false, model: 'synthetic',
        downloaded: false, state: 'not_downloaded', downloaded_bytes: 0, total_bytes: null,
        cancelling: false, error: '' } });
    }
    if (route.request().method() === 'GET' && ['/api/vault/global-index', '/api/vault/alias-index'].includes(pathname)) {
      return route.fulfill({ json: {} });
    }
    if (pathname.startsWith('/api/')) return route.fallback();
    const file = route.request().isNavigationRequest() ? resolve(BUNDLE, 'index.html')
      : resolve(BUNDLE, `.${decodeURIComponent(pathname)}`);
    if (!file.startsWith(BUNDLE + sep)) return route.abort('blockedbyclient');
    return route.fulfill({ path: file });
  });

  await page.goto(`${ORIGIN}/@synthetic/knowledge/drawing/synthetic-drawing`);
  const pen = page.getByTestId('tools.draw');
  await expect(pen).toBeVisible({ timeout: 20_000 });
  const releaseNotes = page.getByRole('button', { name: /Tanca les notes de la versió/i });
  if (await releaseNotes.count()) await releaseNotes.click();
  const importCanvas = page.getByText('Importa .canvas', { exact: true });
  const exportCanvas = page.getByRole('button', { name: 'Exporta .canvas' });
  await expect(exportCanvas).toHaveCSS('font-size', await importCanvas.evaluate(el => getComputedStyle(el).fontSize));
  await expect(exportCanvas).toHaveCSS('line-height', await importCanvas.evaluate(el => getComputedStyle(el).lineHeight));
  // The reported regression left the toolbar usable only for the first five seconds.
  await page.waitForTimeout(6_000);
  const iconMask = (tool: string) => page.getByTestId(tool).locator('.tlui-icon')
    .evaluate(element => getComputedStyle(element).maskImage);
  const penMask = await iconMask('tools.draw');
  const selectMask = await iconMask('tools.select');
  expect(penMask).toMatch(/^url\(/);
  expect(selectMask).toMatch(/^url\(/);
  expect(penMask).not.toBe(selectMask);
  await pen.click();

  const canvas = page.locator('.tl-canvas').first();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('The drawing canvas has no visible bounds');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x - 60, y - 30);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 30, { steps: 12 });
  await page.mouse.up();
  const shapeIds = () => Object.keys(requireJsonObject(requireJsonObject(saved.document).store))
    .filter(id => id.startsWith('shape:'));
  await expect.poll(() => saved.document ? shapeIds().length : 0).toBe(1);
  const storedIds = shapeIds();
  const stroke = page.locator('.tl-shape[data-shape-type="draw"] svg path').first();
  await expect(stroke).toBeVisible();
  const pathData = await stroke.getAttribute('d');
  if (!pathData) throw new Error('The saved stroke has no rendered geometry');
  await page.reload();
  await expect(stroke).toHaveAttribute('d', pathData);
  await page.waitForTimeout(6_000);
  await expect(pen).toBeVisible();
  await expect(stroke).toBeVisible();
  const pageMenu = page.getByTestId('main.page-menu');
  await pageMenu.click();
  await page.getByTestId('page-menu.create').click();
  await expect(stroke).toHaveCount(0);
  await page.getByTestId('page-menu.edit').click();
  await page.getByTestId('page-menu-item-page:page').click();
  await expect(stroke).toHaveAttribute('d', pathData);
  expect(shapeIds()).toEqual(storedIds);
  expect(audit.unknownApiRequests).toEqual([]);
  expect(audit.externalRequests).toEqual([]);
});
