import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const ORIGIN = 'http://127.0.0.1:5189';
let server: ChildProcess;
let log = '';
const errors = new WeakMap<Page, string[]>();
test.use({ proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1,localhost' } });
test.setTimeout(90_000);

test.beforeAll(async () => {
  server = spawn(process.execPath, ['tests/e2e/support/modal-layers/server.mjs'], {
    cwd: ROOT, env: { ...process.env, VITE_DEV_HTTPS: '0' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', chunk => { log = (log + String(chunk)).slice(-8000); });
  server.stderr?.on('data', chunk => { log = (log + String(chunk)).slice(-8000); });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Owned modal fixture exited: ${log}`);
    try { if ((await fetch(`${ORIGIN}/tests/fixtures/modal-layers.html`)).ok) return; } catch { /* Wait for the owned listener. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Owned modal fixture did not become ready: ${log}`);
});

test.afterAll(async () => {
  if (!server?.pid || server.exitCode !== null) return;
  const stopped = new Promise(resolve => server.once('exit', resolve));
  process.kill(-server.pid, 'SIGTERM');
  await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 5000))]);
  if (server.exitCode === null) process.kill(-server.pid, 'SIGKILL');
});

test.beforeEach(async ({ context, page }) => {
  const unexpected: string[] = [];
  errors.set(page, unexpected);
  page.on('pageerror', error => { unexpected.push(error.message); });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const send = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/ai/usage/history') return send({ currency: { code: 'EUR', symbol: '€', usd_rate: 1, source: 'fixture', fetched_at: '2026-01-01T00:00:00Z' }, periods: {} });
      if (url.pathname === '/api/reader/sources' || url.pathname === '/api/schedulers') return send([]);
      unexpected.push(`Unexpected fixture API: ${url.pathname}`);
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    }
    if (url.origin === ORIGIN) return route.continue();
    unexpected.push(`External fixture request: ${url.origin}`);
    return route.abort();
  });
  await page.goto(`${ORIGIN}/tests/fixtures/modal-layers.html`);
  await expect(page.getByTestId('table-actions')).toBeVisible();
});

test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

async function receivesClick(locator: Locator) {
  await expect(locator).toBeVisible();
  expect(await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit === element || (hit !== null && element.contains(hit));
  })).toBe(true);
}

test('translation controls receive real clicks above an embedded editor and sticky toolbar', async ({ page }, testInfo) => {
  await page.evaluate(() => { window.scrollTo(0, 60); });
  await page.getByRole('button', { name: 'translation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Traduir fila', exact: true });
  const language = dialog.getByRole('checkbox', { name: /Castellà/ });
  await receivesClick(language);
  await language.check({ timeout: 3000 });
  await expect(dialog.getByRole('button', { name: 'Traduir', exact: true })).toBeEnabled();
  for (let step = 0; step < 16; step += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('translation-above-editor.png') });
  await receivesClick(dialog.getByRole('button', { name: 'Cancel·lar', exact: true }));
  await dialog.getByRole('button', { name: 'Cancel·lar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'translation', exact: true }).click();
  await dialog.getByRole('button', { name: 'Tanca', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('small windows keep the footer clickable and hidden panes retain selected languages', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 760, height: 520 });
  await page.getByRole('button', { name: 'translation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Traduir fila', exact: true });
  const language = dialog.getByRole('checkbox', { name: /Castellà/ });
  await language.check();
  await receivesClick(dialog.getByRole('button', { name: 'Cancel·lar', exact: true }));
  await page.screenshot({ path: testInfo.outputPath('translation-small-window.png') });
  await page.keyboard.press('F8');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Background action', exact: true }).click();
  await expect(page.getByTestId('background-count')).toHaveText('1');
  await page.keyboard.press('F8');
  await expect(language).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('shared confirmation and prompt actions remain interactive inside a node view', async ({ page }) => {
  await page.getByRole('button', { name: 'confirm', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirmation contract' });
  await receivesClick(confirm.getByRole('button', { name: 'Confirm fixture' }));
  await confirm.getByRole('button', { name: 'Confirm fixture' }).click();
  await expect(page.getByTestId('confirmed')).toHaveText('1');
  await page.getByRole('button', { name: 'prompt', exact: true }).click();
  const prompt = page.getByRole('dialog', { name: 'Prompt contract' });
  await prompt.getByRole('textbox', { name: 'Draft' }).fill('Retained literal text');
  await prompt.getByRole('button', { name: 'Save fixture' }).click();
  await expect(page.getByTestId('saved-draft')).toHaveText('Retained literal text');
});

test('nested history and portaled menus stay above their parent with body pointer locking', async ({ page }, testInfo) => {
  await page.evaluate(() => { document.body.style.pointerEvents = 'none'; });
  await page.getByRole('button', { name: 'nested', exact: true }).click();
  const parent = page.getByRole('dialog', { name: 'Parent settings' });
  await parent.getByRole('button', { name: 'Open menu' }).click();
  const option = page.getByRole('button', { name: 'Choose option' });
  await receivesClick(option); await option.click();
  await expect(page.getByTestId('menu-choice')).toHaveText('selected');
  await parent.getByRole('button', { name: 'Open history' }).click();
  const history = page.locator('.usage-history-modal[role="dialog"]');
  await receivesClick(history.getByRole('button', { name: 'Tanca', exact: true }));
  await page.screenshot({ path: testInfo.outputPath('nested-history.png') });
  await page.keyboard.press('Escape');
  await expect(history).toHaveCount(0);
  await parent.getByRole('button', { name: 'Close parent' }).click();
  await expect(parent).toHaveCount(0);
});

test('feed manager is visible and clickable before Settings has loaded', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'feeds', exact: true }).click();
  const dialog = page.locator('.feed-modal[role="dialog"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('.feed-tab').nth(1).click();
  await expect(dialog.locator('.feed-tab').nth(1)).toHaveClass(/feed-tab--active/);
  await receivesClick(dialog.getByRole('button', { name: 'Tanca', exact: true }));
  await page.screenshot({ path: testInfo.outputPath('feed-manager-direct.png') });
  await dialog.getByRole('button', { name: 'Tanca', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
