import { expect, test } from '@playwright/test';

import { installDisposableNetwork, seedDisposableBrowser } from '../../support/disposable-web.ts';

const TARGET = 'b575a08c-c86e-4b5b-9485-d1f81657264b';
const EXTRACTED = '3253c18b-1b51-41fd-968a-24376a89c612';
const BODY = `# Detailed source\n\n**Rich embedded text**\n\n${'Context from the source note. '.repeat(25)}END OF COMPLETE TRANSCLUSION\n\n| Topic | Status |\n| --- | --- |\n| Search | Complete |\n\n\`\`\`ts\nconst complete = true;\n\`\`\``;

test('global body search and complete rich transclusions in a disposable Vault', async ({ context, page }, testInfo) => {
  test.setTimeout(90_000);
  const audit = await installDisposableNetwork(context);
  await seedDisposableBrowser(context);
  const errors: string[] = [];
  const original = `Disposable knowledge content\n\n![[${TARGET}]]\n\n\`\`\`query\ncontent:needle\n\`\`\``;
  let source = original;
  let applied = false;
  const changes = [
    { id: 'synthetic-page', title: 'Synthetic acceptance note', before: original, after: `![[${EXTRACTED}]]`, etag: 'synthetic-etag', created: false },
    { id: EXTRACTED, title: 'Synthetic extracted note', before: '', after: original, etag: null, created: true },
  ];
  page.on('pageerror', error => { errors.push(error.message); });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.fallback();
    const send = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: { ETag: 'synthetic-etag' }, body: JSON.stringify(body) });
    if (url.pathname.endsWith('/search')) return send({ results: [{ id: 'synthetic-page', title: 'Synthetic acceptance note', path: 'Notes/synthetic.md', excerpt: 'A needle found only in the full note body.', line: 302, tags: ['acceptance'] }], total: 1, limit: 50, offset: 0 });
    if (url.pathname === '/api/vault/composer/preview' && route.request().method() === 'POST') return send({ request: route.request().postDataJSON(), token: 'a'.repeat(64), changes, rewritten_links: 0 });
    if (url.pathname === '/api/vault/composer/apply' && route.request().method() === 'POST') {
      applied = true; source = `![[${EXTRACTED}]]`;
      return send({ source_id: 'synthetic-page', target_id: EXTRACTED, changes });
    }
    if (url.pathname.endsWith('/pages/synthetic-page')) return send({ id: 'synthetic-page', title: 'Synthetic acceptance note', folder: '', metadata: { id: 'synthetic-page', tags: ['acceptance'] }, content: source, etag: applied ? 'synthetic-after-composition' : 'synthetic-etag' });
    if (url.pathname.endsWith(`/pages/${EXTRACTED}`) && applied) return send({ id: EXTRACTED, title: 'Synthetic extracted note', folder: '', metadata: { id: EXTRACTED }, content: original, etag: 'synthetic-extracted-etag' });
    if (url.pathname.endsWith(`/pages/${TARGET}`)) return send({ id: TARGET, title: 'Embedded target', folder: '', metadata: { id: TARGET }, content: BODY, etag: 'synthetic-etag' });
    if (url.pathname.endsWith('/global-index')) return send({ 'synthetic-page': 'Synthetic acceptance note', [TARGET]: 'Embedded target', ...(applied ? { [EXTRACTED]: 'Synthetic extracted note' } : {}) });
    if (url.pathname.endsWith('/alias-index')) return send({});
    return route.fallback();
  });
  await page.goto('/@synthetic/knowledge', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.vault-shell__main')).toBeVisible({ timeout: 30_000 });
  const close = page.getByRole('button', { name: /close release notes|tanca les notes|cerrar las notas|fermer les notes/i });
  if (await close.count()) await close.click();
  await page.keyboard.press('Alt+k');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('input').fill('content:needle');
  await expect(dialog.getByText('A needle found only in the full note body.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('global-content-search.png'), fullPage: true });
  await dialog.getByRole('button', { name: /Synthetic acceptance note/ }).click();
  await expect(page.getByText('END OF COMPLETE TRANSCLUSION', { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('strong').filter({ hasText: 'Rich embedded text' })).toBeVisible();
  await expect(page.locator('table').filter({ hasText: 'Search' })).toBeVisible();
  await expect(page.locator('pre code').filter({ hasText: 'const complete = true' })).toBeVisible();
  await expect(page.getByText('A needle found only in the full note body.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('rich-transclusion-and-query.png'), fullPage: true });
  await page.getByRole('button', { name: 'Afegeix un marcador', exact: true }).click();
  const bookmarkForm = page.locator('section form').filter({ has: page.getByLabel('Grup', { exact: true }) });
  await bookmarkForm.getByLabel('Nom', { exact: true }).fill('Synthetic saved query');
  await bookmarkForm.getByRole('combobox', { name: 'Tipus', exact: true }).selectOption('search');
  await bookmarkForm.getByLabel('Consulta', { exact: true }).fill('content:needle');
  await bookmarkForm.getByLabel('Grup', { exact: true }).fill('Synthetic research');
  await bookmarkForm.getByRole('button', { name: 'Desar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic research' })).toBeVisible();
  await page.getByRole('button', { name: 'Synthetic saved query', exact: true }).click();
  await expect(page.getByText('A needle found only in the full note body.')).toHaveCount(2);
  await page.getByRole('button', { name: 'Opcions de pàgina', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Canviar a vista codi', exact: true }).click();
  await expect(page.locator('.cm-editor .cm-content')).toBeVisible();
  await page.getByRole('switch', { name: 'Previsualització', exact: true }).click();
  await expect(page.locator('.markdown-code-preview')).toContainText('END OF COMPLETE TRANSCLUSION');
  await page.screenshot({ path: testInfo.outputPath('markdown-preview-and-bookmarks.png'), fullPage: true });
  await page.getByRole('button', { name: 'Opcions de pàgina', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Combina i extreu notes', exact: true }).click();
  const composer = page.getByRole('dialog', { name: 'Combina i extreu notes', exact: true });
  await composer.getByRole('textbox', { name: 'Títol de la nota nova', exact: true }).fill('Synthetic extracted note');
  await composer.getByRole('button', { name: 'Previsualitza els canvis', exact: true }).click();
  await expect(composer.getByText('Synthetic extracted note — Nota nova', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('note-composer-preview.png'), fullPage: true });
  await composer.getByRole('button', { name: 'Aplica els canvis revisats', exact: true }).click();
  await expect(composer).not.toBeVisible();
  expect(applied).toBe(true);
  await expect(page.locator('.cm-editor .cm-content')).toContainText(`![[${EXTRACTED}]]`);
  await testInfo.attach('network-audit.json', { body: JSON.stringify({ ...audit, errors }), contentType: 'application/json' });
  expect(audit.unknownApiRequests).toEqual([]);
  expect(errors).toEqual([]);
  expect(audit.externalRequests).toEqual([]);
});
