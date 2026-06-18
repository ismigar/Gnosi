import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * VaultTable — el clic sobre el TÍTOL edita inline (com la resta de camps),
 * NO obre la fitxa. Obrir = botons de l'esquerra / Alt+O.
 * (Canvi 2026-06-03; vegeu directiva vault_table_cell_grid.md.)
 *
 * Prova NO destructiva: obre l'editor del títol i el tanca amb Escape sense
 * teclejar → cap PATCH, no escriu a disc (l'autosave només desa amb valor canviat).
 *
 * Portable: descobreix una taula del vault amb ≥2 files via /api/vault/tables
 * (no hardcodeja cap id, que és per màquina). Si no en troba cap, salta.
 */

// Files de dades = files amb 2a <td> (la 1a és accions/checkbox). Les files
// espaiadores de la virtualització NO tenen 2a <td>, així `td:nth-child(2)` les
// filtra de manera natural. La cel·la de títol és la 2a <td>.
const titleCell = (page: Page, k: number): Locator =>
  page.locator('table tbody tr td:nth-child(2)').nth(k);

// Descobriment fet un sol cop per worker i cachejat.
let resolvedTableUrl: string | null = null;
let scanDone = false;

async function discoverTableWithRows(page: Page): Promise<string | null> {
  const res = await page.request.get('/api/vault/tables');
  if (!res.ok()) return null;
  const tables = (await res.json()) as Array<{ id: string }>;
  for (const t of tables.slice(0, 8)) {
    await page.goto(`/vault/table/${t.id}`, { waitUntil: 'domcontentloaded' });
    // ≥2 cel·les de títol ⇒ ≥2 files de dades (cal nth(0) i nth(1) als tests).
    const secondTitle = page.locator('table tbody tr td:nth-child(2)').nth(1);
    const ok = await secondTitle
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (ok) return `/vault/table/${t.id}`;
  }
  return null;
}

test.describe('VaultTable: clic al títol edita (no obre)', () => {
  test.describe.configure({ timeout: 60_000 }); // marge per al descobriment de taula

  test.beforeEach(async ({ page }) => {
    if (!scanDone) {
      scanDone = true;
      resolvedTableUrl = await discoverTableWithRows(page);
    }
    test.skip(!resolvedTableUrl, 'cap taula del vault amb ≥2 files en aquesta màquina');

    await page.goto(resolvedTableUrl!, { waitUntil: 'domcontentloaded' });
    await page
      .locator('table tbody tr td:nth-child(2) span.truncate')
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 });
  });

  test('doble-clic al títol obre l\'editor inline i NO navega a la fitxa', async ({ page }) => {
    const cell = titleCell(page, 0);
    await cell.waitFor({ state: 'visible' });

    await cell.dblclick({ force: true }); // force: evita el flakiness d'estabilitat de files virtualitzades

    const editor = cell.locator('input');
    await expect(editor).toBeVisible({ timeout: 3_000 }); // editor inline a la cel·la
    await expect(editor).not.toHaveValue('');             // duu el títol actual
    await expect(page).toHaveURL(/\/vault\/table\//);      // NO ha obert la fitxa

    await page.keyboard.press('Escape');                  // tanca sense desar
    await expect(editor).toHaveCount(0);
  });

  test('clic sobre la cel·la de títol ja activa edita (1r clic només selecciona)', async ({ page }) => {
    const cell = titleCell(page, 1); // fila no auto-activa (la 0 ho és en carregar)
    await cell.waitFor({ state: 'visible' });

    await cell.click({ force: true });                        // 1r clic: selecciona (cursor)
    await expect(cell.locator('input')).toHaveCount(0);       // encara NO edita
    await expect(page).toHaveURL(/\/vault\/table\//);

    await cell.click({ force: true });                        // 2n clic sobre activa: edita
    await expect(cell.locator('input')).toBeVisible({ timeout: 3_000 });
    await expect(page).toHaveURL(/\/vault\/table\//);

    await page.keyboard.press('Escape');
  });

  test('el botó d\'obrir de l\'esquerra SÍ navega a la fitxa', async ({ page }) => {
    const firstRow = page
      .locator('table tbody tr', { has: page.locator('td:nth-child(2) span.truncate') })
      .first();
    // 1r <button> de la cel·la d'accions (td 1) = botó "Obrir" (icona ExternalLink).
    const openBtn = firstRow.locator('td:nth-child(1) button').first();
    await openBtn.scrollIntoViewIfNeeded();
    await openBtn.click({ force: true });

    await expect(page).toHaveURL(/\/vault\/page\//, { timeout: 10_000 });
  });
});
