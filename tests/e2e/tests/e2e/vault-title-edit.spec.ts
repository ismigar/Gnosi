import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * VaultTable — clicking the TITLE edits inline (like the rest of the fields),
 * it does NOT open the record. Open = left-hand buttons / Alt+O.
 * (Change 2026-06-03; see vault_table_cell_grid.md directive.)
 *
 * NON-destructive test: opens the title editor and closes it with Escape without
 * typing → no PATCH, nothing written to disk (autosave only saves on a changed value).
 *
 * Portable: discovers a vault table with ≥2 rows via /api/vault/tables
 * (doesn't hardcode any id, which is machine-specific). If it finds none, it skips.
 */

// Data rows = rows with a 2nd <td> (the 1st is actions/checkbox). The
// virtualization spacer rows do NOT have a 2nd <td>, so `td:nth-child(2)`
// filters them out naturally. The title cell is the 2nd <td>.
const titleCell = (page: Page, k: number): Locator =>
  page.locator('table tbody tr td:nth-child(2)').nth(k);

// Discovery done once per worker and cached.
let resolvedTableUrl: string | null = null;
let scanDone = false;

async function discoverTableWithRows(page: Page): Promise<string | null> {
  const res = await page.request.get('/api/vault/tables');
  if (!res.ok()) return null;
  const tables = (await res.json()) as Array<{ id: string }>;
  for (const t of tables.slice(0, 8)) {
    await page.goto(`/vault/table/${t.id}`, { waitUntil: 'domcontentloaded' });
    // ≥2 title cells ⇒ ≥2 data rows (need nth(0) and nth(1) in the tests).
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
  test.describe.configure({ timeout: 60_000 }); // margin for table discovery

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

    await cell.dblclick({ force: true }); // force: avoids flakiness in the stability of virtualized rows

    const editor = cell.locator('input');
    await expect(editor).toBeVisible({ timeout: 3_000 }); // editor inline a la cel·la
    await expect(editor).not.toHaveValue('');             // carries the current title
    await expect(page).toHaveURL(/\/vault\/table\//);      // did NOT open the page

    await page.keyboard.press('Escape');                  // closes without saving
    await expect(editor).toHaveCount(0);
  });

  test('clic sobre la cel·la de títol ja activa edita (1r clic només selecciona)', async ({ page }) => {
    const cell = titleCell(page, 1); // row is not auto-active (row 0 is, on load)
    await cell.waitFor({ state: 'visible' });

    await cell.click({ force: true });                        // 1r clic: selecciona (cursor)
    await expect(cell.locator('input')).toHaveCount(0);       // still does NOT edit
    await expect(page).toHaveURL(/\/vault\/table\//);

    await cell.click({ force: true });                        // 2nd click on active: edit
    await expect(cell.locator('input')).toBeVisible({ timeout: 3_000 });
    await expect(page).toHaveURL(/\/vault\/table\//);

    await page.keyboard.press('Escape');
  });

  test('el botó d\'obrir de l\'esquerra SÍ navega a la fitxa', async ({ page }) => {
    const firstRow = page
      .locator('table tbody tr', { has: page.locator('td:nth-child(2) span.truncate') })
      .first();
    // 1st <button> in the actions cell (td 1) = "Open" button (ExternalLink icon).
    const openBtn = firstRow.locator('td:nth-child(1) button').first();
    await openBtn.scrollIntoViewIfNeeded();
    await openBtn.click({ force: true });

    await expect(page).toHaveURL(/\/vault\/page\//, { timeout: 10_000 });
  });
});
