import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { components } from '../../../../frontend/src/generated/openapi';

import { installDisposableNetwork, seedDisposableBrowser } from '../../support/disposable-web.ts';

type Bundle = components['schemas']['PublicationBundle'];
type Summary = components['schemas']['PublicationSummary'];
const TOKEN = 'p'.repeat(43);
const PREVIEW = 'v'.repeat(43);
const SITE_ID = 'c'.repeat(32);
// Exercise the producer/renderer boundary; prepared Markdown alone can hide
// normalization damage that affects both the preview and the public reader.
const BUNDLE = JSON.parse(execFileSync(fileURLToPath(new URL(
  process.platform === 'win32' ? '../../../../.venv/Scripts/python.exe' : '../../../../.venv/bin/python', import.meta.url,
)), [fileURLToPath(new URL('../../support/publication-snapshot.py', import.meta.url))], { encoding: 'utf8' })) as Bundle;

async function expectFidelity(surface: import('@playwright/test').Locator) {
  await expect(surface.locator('table')).toHaveCount(2);
  await expect(surface.locator('table').nth(0).locator('th')).toHaveCount(2);
  await expect(surface.locator('table').nth(1).locator('th')).toHaveCount(3);
  await expect(surface.locator('table').nth(1).locator('tbody tr').nth(0).locator('td')).toHaveText(['Rendering', 'Preserved', 'Three']);
  const pipeCells = surface.locator('table').nth(1).locator('tbody tr').nth(1).locator('td');
  await expect(pipeCells).toHaveCount(3);
  await expect(pipeCells.nth(0).locator('code')).toHaveText('left|right');
  await expect(pipeCells.nth(1).locator('annotation')).toHaveText('x\\|y');
  await expect(pipeCells.nth(2)).toHaveText('plain|text');
  await expect(surface.locator('p').filter({ hasText: '1. This is a literal paragraph.' })).toHaveText('1. This is a literal paragraph.');
  await expect(surface.locator('p').filter({ hasText: '- This is another literal paragraph.' })).toHaveText('- This is another literal paragraph.');
  await expect(surface.locator('ol')).toHaveCount(1);
  await expect(surface.locator('ul')).toHaveCount(1);
  await expect(surface.locator('ol')).toHaveAttribute('start', '3');
  await expect(surface.locator('input[type="checkbox"]')).toHaveCount(2);
  await expect(surface.locator('input[type="checkbox"]').nth(0)).toBeChecked();
  await expect(surface.locator('input[type="checkbox"]').nth(1)).not.toBeChecked();
  await expect(surface.locator('.mfrac')).toHaveCount(2);
  await expect(surface.locator('.katex-display')).toHaveCount(1);
  await expect(surface.locator('.katex-error')).toHaveCount(0);
  await expect(surface.locator('pre code')).toContainText('Code keeps $\\frac{a}{b}$ literal.');
  await expect(surface.locator('img, iframe, object, embed')).toHaveCount(0);
}

test('publication manager reviews, creates, updates and revokes only explicit snapshots', async ({ context, page }, testInfo) => {
  test.setTimeout(90_000);
  const audit = await installDisposableNetwork(context);
  await seedDisposableBrowser(context);
  await context.addInitScript(() => { localStorage.setItem('gnosi_active_vault', 'synthetic-vault'); });
  const errors: string[] = [];
  page.on('pageerror', error => { errors.push(error.message); });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  let current: Summary | null = null;
  let previewCount = 0;
  let commitCount = 0;
  let revokeCount = 0;
  let selected: string[] = [];
  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.fallback();
    const send = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/vault/plugins') return send({ disabled: [], enabled_builtin: ['share-links'], enabled_third_party: [], settings: {} });
    if (url.pathname.endsWith('/pages/synthetic-page/shares')) return send({ shares: [] });
    if (url.pathname.endsWith('/global-index')) return send({ 'synthetic-page': 'Synthetic acceptance note' });
    if (url.pathname.endsWith('/alias-index')) return send({});
    if (!url.pathname.startsWith('/api/vault/publishing')) return route.fallback();
    expect(request.headers()['x-gnosi-expected-user-id']).toBe('synthetic-user');
    expect(request.headers()['x-workspace-id']).toBe('synthetic-workspace');
    expect(request.headers()['x-vault-id']).toBe('synthetic-vault');
    if (url.pathname === '/api/vault/publishing/pages' && request.method() === 'GET') return send([
      { id: 'synthetic-page', title: 'First selected note' },
      { id: 'synthetic-second', title: 'Second selected note' },
      { id: 'never-selected', title: 'Never selected private note' },
    ]);
    if (url.pathname === '/api/vault/publishing' && request.method() === 'GET') return send(current ? [current] : []);
    if (url.pathname === '/api/vault/publishing/preview' && request.method() === 'POST') {
      const body = request.postDataJSON() as components['schemas']['PublicationSelection'];
      expect(body.title).toBe(BUNDLE.title);
      expect(body.page_ids).toEqual(['synthetic-page', 'synthetic-second']);
      expect(body.site_id).toBe(current?.id ?? null);
      expect(body.expected_revision).toBe(current?.revision ?? null);
      selected = body.page_ids;
      previewCount += 1;
      return send({ preview_id: PREVIEW, preview_expires_at: 9999999999, bundle: { ...BUNDLE, revision: previewCount } });
    }
    if (url.pathname === '/api/vault/publishing/commit' && request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual({ preview_id: PREVIEW });
      commitCount += 1;
      current = { id: SITE_ID, token: TOKEN, title: BUNDLE.title, page_ids: selected, revision: commitCount,
        created_at: BUNDLE.published_at, updated_at: BUNDLE.published_at, expires_at: null, revoked: false };
      return send(current);
    }
    if (url.pathname === `/api/vault/publishing/${SITE_ID}/revoke` && request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual({ expected_revision: 2 });
      if (!current) throw new Error('Publication must exist before revocation');
      current = { ...current, revoked: true };
      revokeCount += 1;
      return send(current);
    }
    return route.fallback();
  });

  try {
    await page.goto('/@synthetic/knowledge/page/synthetic-page', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.vault-shell__main')).toBeVisible({ timeout: 30_000 });
    const release = page.getByRole('button', { name: /close release notes|tanca les notes|cerrar las notas|fermer les notes/i });
    if (await release.count()) await release.click();
    await page.getByRole('button', { name: 'Opcions de pàgina', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Comparteix', exact: true }).click();
    await page.getByRole('button', { name: 'Publica notes seleccionades', exact: true }).click();
    const manager = page.getByRole('dialog', { name: 'Publica notes seleccionades', exact: true });
    await expect(manager.getByRole('switch', { name: 'First selected note', exact: true })).toHaveAttribute('aria-checked', 'false');
    await expect(manager.getByRole('button', { name: 'Publica aquesta previsualització', exact: true })).toBeDisabled();
    await manager.getByLabel('Títol del lloc', { exact: true }).fill(BUNDLE.title);
    await manager.getByRole('switch', { name: 'First selected note', exact: true }).click();
    await manager.getByRole('switch', { name: 'Second selected note', exact: true }).click();
    await manager.getByRole('button', { name: 'Previsualitza les notes seleccionades', exact: true }).click();
    const preview = manager.getByRole('region', { name: 'Previsualització de la publicació', exact: true });
    await expect(preview.locator('strong')).toHaveText('Reviewed snapshot');
    await expectFidelity(preview);
    await preview.getByRole('link', { name: 'Second note', exact: true }).click();
    await expect(preview.getByText('A searchable phrase only in the second note.', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('publication-preview.png'), fullPage: true });
    await manager.getByRole('button', { name: 'Publica aquesta previsualització', exact: true }).click();
    await expect(manager.getByRole('link', { name: new RegExp(`/p/${TOKEN}$`) })).toBeVisible();
    await manager.getByRole('button', { name: 'Actualitza la selecció', exact: true }).click();
    await manager.getByRole('button', { name: 'Previsualitza les notes seleccionades', exact: true }).click();
    await expect(manager.getByRole('button', { name: 'Publica l’actualització', exact: true })).toBeEnabled();
    await manager.getByRole('button', { name: 'Publica l’actualització', exact: true }).click();
    await expect(manager.getByRole('button', { name: 'Actualitza la selecció', exact: true })).toBeEnabled();
    await manager.getByRole('button', { name: 'Revoca', exact: true }).click();
    expect(revokeCount).toBe(0);
    await page.getByRole('dialog', { name: 'Revoca la publicació', exact: true }).getByRole('button', { name: 'Revoca', exact: true }).click();
    await expect(manager.getByText('Revocada', { exact: true })).toBeVisible();
    await expect(manager.getByRole('link')).toHaveCount(0);
    expect({ previewCount, commitCount, revokeCount }).toEqual({ previewCount: 2, commitCount: 2, revokeCount: 1 });
  } finally {
    await testInfo.attach('network-audit.json', { body: JSON.stringify({ ...audit, errors }), contentType: 'application/json' });
  }
  expect(audit.unknownApiRequests).toEqual([]);
  expect(audit.externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('public reader stays anonymous and searches and navigates only its saved bundle', async ({ context, page, baseURL }, testInfo) => {
  if (!baseURL) throw new Error('A disposable frontend origin is required');
  const origin = new URL(baseURL).origin;
  const unknown: string[] = [];
  const errors: string[] = [];
  const requests: string[] = [];
  let available = true;
  page.on('pageerror', error => { errors.push(error.message); });
  await seedDisposableBrowser(context);
  await context.addCookies([{ name: 'gnosi_session', value: 'synthetic-private-cookie', url: origin, httpOnly: true }]);
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) { unknown.push(request.url()); return route.abort('blockedbyclient'); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push(`${request.method()} ${url.pathname}`);
    if (request.method() !== 'GET' || url.pathname !== `/api/published/${TOKEN}`) {
      unknown.push(request.url());
      return route.abort('blockedbyclient');
    }
    for (const header of ['authorization', 'cookie', 'x-user-id', 'x-vault-id', 'x-workspace-id', 'x-gnosi-expected-user-id', 'referer']) {
      expect(request.headers()[header]).toBeUndefined();
    }
    return route.fulfill({ status: available ? 200 : 404, contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(available ? BUNDLE : { detail: 'Publication not found' }) });
  });
  try {
    await page.goto(`/p/${TOKEN}`);
    await expect(page.getByRole('heading', { name: BUNDLE.title, exact: true })).toBeVisible();
    await expect(page.locator('article strong')).toHaveText('Reviewed snapshot');
    await expect(page.locator('article table').first()).toContainText('Publication');
    await expectFidelity(page.locator('article'));
    expect(requests).toEqual([`GET /api/published/${TOKEN}`]);
    await page.getByRole('link', { name: 'Second note', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${TOKEN}\\?page=p2#details$`));
    await expect(page.locator('article')).toContainText('A searchable phrase only in the second note.');
    await page.getByRole('searchbox').fill('searchable phrase');
    await expect(page.getByRole('navigation').getByRole('button')).toHaveCount(1);
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Second selected note', exact: true })).toBeVisible();
    await page.getByRole('searchbox').fill('not present');
    await expect(page.getByRole('navigation').getByRole('button')).toHaveCount(0);
    await page.getByRole('searchbox').fill('');
    await page.goBack();
    await expect(page.locator('article strong')).toHaveText('Reviewed snapshot');
    await page.screenshot({ path: testInfo.outputPath('published-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('searchbox')).toBeVisible();
    await page.getByRole('navigation').getByRole('button', { name: 'Second selected note', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('published-mobile.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByText('End of the saved note.', { exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(requests).toHaveLength(1);
    available = false;
    await page.getByRole('button', { name: /refresh|actualitza/i }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(0);
    await page.goto('/p/invalid-token');
    await expect(page.getByRole('alert')).toBeVisible();
    expect(requests).toHaveLength(2);
  } finally {
    await testInfo.attach('public-network-audit.json', { body: JSON.stringify({ requests, unknown, errors }), contentType: 'application/json' });
  }
  expect(unknown).toEqual([]);
  expect(errors).toEqual([]);
});
