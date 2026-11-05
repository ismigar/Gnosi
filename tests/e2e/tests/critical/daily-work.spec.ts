import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { acceptanceState, contextHeaders, ownedAcceptancePath } from '../../support/acceptance-state.ts';
import { requireJsonObject } from '../../support/json-value.ts';

test('table settings retire Drupal controls and Webs creation keeps translated help', async ({ page }, testInfo) => {
  const state = acceptanceState();
  await page.addInitScript(() => { localStorage.setItem('i18nextLng', 'en'); });
  await page.goto(`/@${state.primary_vault.slug}/knowledge/table/${state.table_id}`);
  await page.getByRole('button', { name: 'Fields', exact: true }).click();
  const schema = page.getByRole('dialog', { name: /manage properties/i });
  await expect(schema).toBeVisible();
  await expect(schema).not.toContainText(/drupal/i);
  await page.screenshot({ path: testInfo.outputPath('table-settings-without-drupal.png'), fullPage: true });
  await schema.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(schema).toBeHidden();
  await page.goto(`/@${state.primary_vault.slug}/websites`);
  await page.getByRole('button', { name: 'Create website', exact: true }).click();
  const creation = page.getByRole('dialog', { name: 'Create website', exact: true });
  const mode = creation.getByRole('combobox');
  await expect(mode).toHaveValue('blank');
  await expect(creation).toContainText('Create a blank website');
  await mode.selectOption({ label: 'Import a website by URL' });
  await expect(creation).toContainText('Enter a public website. Review and choose its pages before importing.');
  await creation.getByRole('textbox', { name: 'Website name', exact: true }).fill('Acceptance URL import');
  await creation.getByRole('textbox', { name: 'Source website URL', exact: true }).fill('https://example.org');
  await expect(creation.getByRole('button', { name: 'Analyze website', exact: true })).toBeEnabled();
  await expect(creation.getByRole('button', { name: 'Import selected pages', exact: true })).toBeDisabled();
  await expect(creation).not.toContainText(/temenos|drupal|websites\.(?:import\w+|createMode|sourceUrl)/i);
  await page.screenshot({ path: testInfo.outputPath('webs-creation-translated-help.png'), fullPage: true });
  await creation.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('a daily session saves title and body and can reopen the same real page', async ({ page }, testInfo) => {
  const state = acceptanceState();
  const headers = contextHeaders(state);
  const create = await page.request.post('/api/vault/pages', {
    headers, data: { title: 'Acceptance daily note', content: 'Original daily content', metadata: { acceptance_marker: 'preserve-this-value' } },
  });
  expect(create.ok()).toBe(true);
  const created = requireJsonObject(await create.json());
  expect(typeof created.id).toBe('string');
  const id = String(created.id);
  const errors: string[] = [];
  page.on('pageerror', error => { errors.push(error.message); });
  await page.goto(`/@${state.primary_vault.slug}/knowledge/page/${encodeURIComponent(id)}`);
  const title = page.locator('.vault-page-title:visible');
  const body = page.locator('.bn-editor[contenteditable="true"]:visible');
  await expect(title).toHaveValue('Acceptance daily note');
  await title.fill('Accepted daily title');
  await body.fill('Content saved through the production editor.');
  await expect.poll(async () => {
    const response = await page.request.get(`/api/vault/pages/${encodeURIComponent(id)}`, { headers });
    expect(response.ok()).toBe(true);
    const document = requireJsonObject(await response.json());
    return { title: document.title, content: document.content };
  }, { timeout: 10_000 }).toEqual({ title: 'Accepted daily title', content: expect.stringContaining('Content saved through the production editor.') });
  await page.reload();
  await expect(title).toHaveValue('Accepted daily title');
  await expect(body).toContainText('Content saved through the production editor.');
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('daily-note-reopened.png'), fullPage: true });
  fs.writeFileSync(ownedAcceptancePath('GNOSI_ACCEPTANCE_EXPECTED'), JSON.stringify({ id, title: 'Accepted daily title', content: 'Content saved through the production editor.', marker: 'preserve-this-value' }));
});

test('switching vaults keeps the previous vault page outside the new context', async ({ page }) => {
  const state = acceptanceState();
  const primary = await page.request.get('/api/vault/pages', { headers: contextHeaders(state) });
  expect(primary.ok()).toBe(true);
  const secondary = await page.request.get('/api/vault/pages', { headers: contextHeaders(state, state.secondary_vault) });
  expect(secondary.ok()).toBe(true);
  const primaryRows = await primary.json() as { id: string }[];
  const secondaryRows = await secondary.json() as { id: string }[];
  expect(primaryRows.some(row => state.row_ids.includes(row.id))).toBe(true);
  expect(secondaryRows.some(row => state.row_ids.includes(row.id))).toBe(false);
  await page.goto(`/@${state.secondary_vault.slug}/knowledge`);
  await expect(page.locator('.vault-shell__main')).toBeVisible();
  await expect(page.locator('.gnosi-route-skeleton')).toHaveCount(0);
  const crossRead = await page.request.get(`/api/vault/pages/${encodeURIComponent(state.row_ids[0] ?? '')}`, { headers: contextHeaders(state, state.secondary_vault) });
  expect([403, 404]).toContain(crossRead.status());
});

test('a real viewer session cannot overwrite an owner page', async ({ playwright, baseURL, page }) => {
  const state = acceptanceState();
  const headers = contextHeaders(state);
  const id = state.row_ids[0];
  expect(id).toBeTruthy();
  const before = await page.request.get(`/api/vault/pages/${String(id)}`, { headers });
  expect(before.ok()).toBe(true);
  const original = requireJsonObject(await before.json());
  const viewer = await playwright.request.newContext({ baseURL });
  try {
    const login = await viewer.post('/api/auth/login', { data: { email: state.viewer.email, password: state.viewer.password } });
    expect(login.ok()).toBe(true);
    const denied = await viewer.patch(`/api/vault/pages/${String(id)}`, { headers, data: { content: 'Unauthorized replacement' } });
    expect(denied.status()).toBe(403);
    const after = await page.request.get(`/api/vault/pages/${String(id)}`, { headers });
    expect(after.ok()).toBe(true);
    expect(requireJsonObject(await after.json()).content).toBe(original.content);
  } finally {
    await viewer.dispose();
  }
});

test('editing and closing a table record restores its active cell and horizontal position', async ({ page }, testInfo) => {
  const state = acceptanceState();
  await page.setViewportSize({ width: 680, height: 600 });
  await page.goto(`/@${state.primary_vault.slug}/knowledge/table/${state.table_id}`);
  const cell = page.locator(`td[data-grid-row="${String(state.row_ids[0])}"][data-grid-field="title"]`);
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(cell).toHaveAttribute('data-active-cell', 'true');
  const scroller = await cell.evaluateHandle(element => {
    let parent = element.parentElement;
    while (parent) {
      if (parent.scrollWidth > parent.clientWidth) return parent;
      parent = parent.parentElement;
    }
    throw new Error('The acceptance table must expose a real horizontal scroll area');
  });
  await scroller.evaluate(element => { element.scrollLeft = Math.min(80, element.scrollWidth - element.clientWidth); });
  const before = await scroller.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }));
  expect(before.left).toBeGreaterThan(0);
  const row = cell.locator('..');
  await row.locator('td:first-child button').first().click();
  const title = page.locator('.vault-page-title:visible');
  await expect(title).toHaveValue('Acceptance first record');
  await title.fill('Accepted table record');
  await expect(title).toHaveValue('Accepted table record');
  const body = page.locator('.bn-editor[contenteditable="true"]:visible');
  await body.fill('Table record saved through the production editor.');
  await expect.poll(async () => {
    const response = await page.request.get(`/api/vault/pages/${String(state.row_ids[0])}`, { headers: contextHeaders(state) });
    expect(response.ok()).toBe(true);
    return requireJsonObject(await response.json()).title;
  }).toBe('Accepted table record');
  const close = page.getByRole('button', { name: /close tab|tanca.*pestanya|cerrar pesta|fermer.*onglet/i });
  await close.click();
  await expect(cell).toContainText('Accepted table record');
  await expect(cell).toHaveAttribute('data-active-cell', 'true');
  await expect.poll(() => scroller.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('table-record-return.png'), fullPage: true });
});
