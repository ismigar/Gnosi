import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

import { installDisposableNetwork, seedDisposableBrowser } from '../../support/disposable-web.ts';

const CANVAS = {
  nodes: [{ id: 'note-card', type: 'file', x: 0, y: 0, width: 560, height: 520,
    file: 'synthetic.md', gnosiPageId: 'synthetic-page', custom: { preserved: true } }],
  edges: [], customRoot: 'retained',
};

test('canvas import/export and unsaved card recovery after workspace restore', async ({ context, page }, testInfo) => {
  test.setTimeout(90_000);
  const audit = await installDisposableNetwork(context);
  await seedDisposableBrowser(context);
  await context.addInitScript(() => {
    localStorage.setItem('gnosi.workspaces', JSON.stringify([{
      version: 2, id: 'saved-notes', name: 'Saved note workspace', vaultId: 'synthetic-vault',
      tabs: [{ id: 'synthetic-page', type: 'page', title: 'Synthetic acceptance note' }],
      layout: { activeTabId: 'synthetic-page', activeTableId: null, activeViewId: null,
        viewMode: 'editor', splitTabIds: [], splitTableIds: [], paneSizes: [100] },
    }]));
  });
  const errors: string[] = [];
  const writes: unknown[] = [];
  let drawing: unknown = {};
  let content = 'Stored card content';
  let etag = 'original-card-revision';
  page.on('pageerror', error => { errors.push(error.message); });
  page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`.trim()); });
  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.fallback();
    const send = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: { ETag: etag }, body: JSON.stringify(body) });
    if (url.pathname.endsWith('/drawings/synthetic-drawing')) {
      if (request.method() === 'PUT') {
        const payload = request.postDataJSON() as { data: unknown };
        drawing = payload.data;
        return send({ id: 'synthetic-drawing', status: 'success' });
      }
      return send(drawing);
    }
    if (url.pathname.endsWith('/handwriting/status')) return send({ available: false, loaded: false, model: 'synthetic', downloaded: false,
      state: 'not_downloaded', downloaded_bytes: 0, total_bytes: null, cancelling: false, error: '' });
    if (url.pathname.endsWith('/pages/synthetic-page')) {
      if (request.method() === 'PATCH') {
        const payload = request.postDataJSON() as { content: string; expected_etag: string };
        writes.push(payload);
        content = payload.content;
        etag = 'saved-card-revision';
        return send({ id: 'synthetic-page', status: 'success', etag });
      }
      return send({ id: 'synthetic-page', title: 'Synthetic acceptance note', folder: '', metadata: { id: 'synthetic-page' }, content, etag });
    }
    if (url.pathname.endsWith('/global-index')) return send({ 'synthetic-page': 'Synthetic acceptance note' });
    if (url.pathname.endsWith('/alias-index')) return send({});
    return route.fallback();
  });

  try {
    await page.goto('/@synthetic/knowledge/drawing/synthetic-drawing', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.vault-shell__main')).toBeVisible({ timeout: 30_000 });
    const close = page.getByRole('button', { name: /close release notes|tanca les notes|cerrar las notas|fermer les notes/i });
    if (await close.count()) await close.click();
    const upload = page.getByLabel('Importa .canvas', { exact: true });
    await expect(upload).toBeAttached({ timeout: 20_000 });
    await upload.setInputFiles({ name: 'synthetic.canvas', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(CANVAS)) });
    const edit = page.getByRole('button', { name: 'Edita el contingut de la pàgina', exact: true });
    await expect(edit).toBeEnabled({ timeout: 15_000 });
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exporta .canvas', exact: true }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error('Canvas export did not produce a download');
    const exported: unknown = JSON.parse(await readFile(downloadPath, 'utf8'));
    expect(exported).toEqual(CANVAS);

    await edit.click();
    await page.getByRole('button', { name: 'Canviar a vista codi', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Contingut de la pàgina', exact: true });
    await source.fill('Unsaved canvas draft survives workspace restore');
    await page.evaluate(() => { window.dispatchEvent(new CustomEvent('gnosi:open-workspaces')); });
    const workspaces = page.getByRole('dialog', { name: 'Espais de Treball', exact: true });
    await workspaces.getByRole('button', { name: 'Saved note workspace 1', exact: true }).click();
    await expect(edit).toHaveCount(0);
    await expect(page.getByText('Stored card content', { exact: true })).toBeVisible();
    expect(writes).toEqual([]);
    await page.locator('.vault-document-tabs').getByText('Sense títol', { exact: true }).click();
    await expect(edit).toBeDisabled();
    await page.getByRole('button', { name: 'Canviar a vista codi', exact: true }).click();
    await expect(source).toHaveValue('Unsaved canvas draft survives workspace restore');
    expect(writes).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('recovered-canvas-draft.png'), fullPage: true });
    await page.locator('.tl-html-container').getByRole('button', { name: 'Desar', exact: true }).click();
    await expect(edit).toBeEnabled();
    expect(writes).toEqual([expect.objectContaining({ content: 'Unsaved canvas draft survives workspace restore', expected_etag: 'original-card-revision' })]);
    await expect(page.getByText('Unsaved canvas draft survives workspace restore', { exact: true })).toBeVisible();
    expect(audit.unknownApiRequests).toEqual([]);
    expect(errors).toEqual([]);
    expect(audit.externalRequests).toEqual([]);
  } finally {
    const auditPath = testInfo.outputPath('network-audit.json');
    await writeFile(auditPath, JSON.stringify({ ...audit, errors, writes }, null, 2));
    await testInfo.attach('network-audit.json', { path: auditPath, contentType: 'application/json' });
  }
});
