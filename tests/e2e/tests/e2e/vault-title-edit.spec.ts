import { test, expect, type Locator, type Page } from '@playwright/test';

import { isJsonObject, requireJsonObject } from '../../support/json-value.ts';

/**
 * VaultTable — clicking the TITLE edits inline (like the rest of the fields),
 * it does NOT open the record. Open = left-hand buttons / Alt+O.
 * (Change 2026-06-03; see vault_table_cell_grid.md directive.)
 *
 * NON-destructive test: opens the title editor and closes it with Escape without
 * typing → no PATCH, nothing written to disk (autosave only saves on a changed value).
 *
 * GNOSI_TEST_TABLE_ID selects a prepared table and fails rather than skipping.
 * Otherwise, discovers a vault table with ≥2 rows via /api/vault/tables
 * (doesn't hardcode any id, which is machine-specific). If it finds none, it skips.
 */

// Use the actual title-cell marker, excluding virtualization spacer rows.
const titleCell = (page: Page, k: number): Locator =>
  page.locator('td[data-title-cell]').nth(k);

// Discovery done once per worker and cached.
const configuredTableId = process.env.GNOSI_TEST_TABLE_ID;
let resolvedTableUrl: string | null = configuredTableId
  ? `/vault/table/${encodeURIComponent(configuredTableId)}` : null;
let scanDone = Boolean(configuredTableId);
const contextHeaders = {
  ...(process.env.GNOSI_TEST_VAULT_ID ? { 'X-Vault-ID': process.env.GNOSI_TEST_VAULT_ID } : {}),
  ...(process.env.GNOSI_TEST_WORKSPACE_ID ? { 'X-Workspace-ID': process.env.GNOSI_TEST_WORKSPACE_ID } : {}),
};

async function openConfiguredTable(page: Page, tableId: string): Promise<void> {
  const response = await page.request.get('/api/vault/registry', { headers: contextHeaders });
  expect(response.ok()).toBe(true);
  const registry = requireJsonObject(await response.json());
  const tables: unknown = registry.tables;
  const databases: unknown = registry.databases;
  if (!Array.isArray(tables) || !Array.isArray(databases)) throw new Error('Invalid registry catalog');
  const table = tables.filter(isJsonObject).find((candidate) => candidate.id === tableId);
  const database = databases.filter(isJsonObject).find((candidate) => candidate.id === table?.database_id);
  if (typeof table?.name !== 'string' || typeof database?.name !== 'string') {
    throw new Error('Configured title table needs a named ordinary database');
  }
  await page.getByRole('link', { name: 'El meu Coneixement', exact: true }).click();
  const sidebar = page.locator('#vault-navigation');
  const dataSection = sidebar.getByRole('button', { name: 'Dades', exact: true });
  await expect(dataSection).toBeVisible({ timeout: 15_000 });
  if (await dataSection.getAttribute('aria-expanded') !== 'true') await dataSection.click();
  const tableButton = sidebar.getByRole('button', { name: table.name, exact: true });
  if (!await tableButton.isVisible()) {
    await sidebar.getByRole('button', { name: database.name, exact: true }).click();
  }
  await tableButton.click();
}

async function discoverTableWithRows(page: Page): Promise<string | null> {
  // Discovery runs before browser startup can add its active-vault cookie.
  const res = await page.request.get('/api/vault/tables', { headers: contextHeaders });
  if (!res.ok()) return null;
  const tables: unknown = await res.json();
  if (!Array.isArray(tables)) throw new Error('Expected a table catalog array');
  for (const rawTable of tables.slice(0, 8)) {
    const table = requireJsonObject(rawTable);
    if (typeof table.id !== 'string') throw new Error('Expected a textual table ID');
    const tableUrl = `/vault/table/${encodeURIComponent(table.id)}`;
    await page.goto(tableUrl, { waitUntil: 'domcontentloaded' });
    // ≥2 title cells ⇒ ≥2 data rows (need nth(0) and nth(1) in the tests).
    const secondTitle = titleCell(page, 1);
    const ok = await secondTitle
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (ok) return tableUrl;
  }
  return null;
}

test.describe('VaultTable: clic al títol edita (no obre)', () => {
  test.describe.configure({ timeout: 60_000 }); // margin for table discovery

  test.beforeEach(async ({ page }) => {
    // These are editing tests, not cold-start deep-link tests. Resolve the real
    // authenticated shell before navigating to a record in its active vault.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: 'El meu Coneixement', exact: true })).toBeVisible();
    if (!scanDone) {
      scanDone = true;
      resolvedTableUrl = await discoverTableWithRows(page);
    }
    if (!resolvedTableUrl) {
      test.skip(true, 'cap taula del vault amb ≥2 files en aquesta màquina');
      return;
    }

    if (configuredTableId) await openConfiguredTable(page, configuredTableId);
    else await page.goto(resolvedTableUrl, { waitUntil: 'domcontentloaded' });
    await expect(titleCell(page, 1)).toBeVisible({ timeout: 15_000 });
  });

  test('doble-clic al títol obre l\'editor inline i NO navega a la fitxa', async ({ page }) => {
    const cell = titleCell(page, 0);
    const tableUrl = page.url();
    await cell.waitFor({ state: 'visible' });

    await cell.dblclick({ force: true }); // force: avoids flakiness in the stability of virtualized rows

    const editor = cell.locator('input');
    await expect(editor).toBeVisible({ timeout: 3_000 }); // editor inline a la cel·la
    await expect(editor).not.toHaveValue('');             // carries the current title
    await expect(page).toHaveURL(tableUrl);               // did NOT open the page

    await page.keyboard.press('Escape');                  // closes without saving
    await expect(editor).toHaveCount(0);
  });

  test('clic sobre la cel·la de títol ja activa edita (1r clic només selecciona)', async ({ page }) => {
    const cell = titleCell(page, 1); // row is not auto-active (row 0 is, on load)
    const tableUrl = page.url();
    await cell.waitFor({ state: 'visible' });

    await cell.click({ force: true });                        // 1r clic: selecciona (cursor)
    await expect(cell.locator('input')).toHaveCount(0);       // still does NOT edit
    await expect(page).toHaveURL(tableUrl);

    await cell.click({ force: true });                        // 2nd click on active: edit
    await expect(cell.locator('input')).toBeVisible({ timeout: 3_000 });
    await expect(page).toHaveURL(tableUrl);

    await page.keyboard.press('Escape');
  });

  test('el botó d\'obrir de l\'esquerra SÍ navega a la fitxa', async ({ page }) => {
    const firstRow = page
      .locator('table tbody tr', { has: page.locator('td[data-title-cell]') })
      .first();
    // 1st <button> in the actions cell (td 1) = "Open" button (ExternalLink icon).
    const openBtn = firstRow.locator('td:nth-child(1) button').first();
    await openBtn.scrollIntoViewIfNeeded();
    await openBtn.click({ force: true });

    await expect(page).toHaveURL(/\/@[^/]+\/knowledge\/page\/[^/?#]+/, { timeout: 10_000 });
  });
});
