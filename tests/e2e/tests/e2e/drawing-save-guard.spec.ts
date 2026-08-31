import { test, expect, type Page, type Route } from '@playwright/test';

import { requireJsonObject } from '../../support/json-value.ts';

/**
 * TldrawEditor — save integrity guard (tldraw_save_integrity.md directive).
 *
 * The bug it covers: if the drawing's GET failed (500, OneDrive online-only)
 * or the snapshot wasn't applied (legacy .excalidraw.json), the component treated
 * the error as a "new drawing" and the 1s autosave OVERWROTE the real file
 * with a blank canvas.
 *
 * Covers:
 * 1. GET 500 ⇒ error overlay, NO PUT (neither autosave nor Ctrl+S); the
 *    "Retry" button recovers the editor when the backend comes back.
 * 2. GET with Excalidraw JSON (legacy) ⇒ incompatible overlay, NO PUT
 *    (the empty .tldraw.json no longer eclipses the legacy file).
 * 3. New drawing ({}): pan/zoom does NOT schedule any PUT (autosave filtered by
 *    'document' scope); drawing a stroke DOES save, with shapes in the snapshot.
 *
 * Everything mocked with page.route: the test doesn't create or touch any real drawing.
 */

const CANVAS = '.tl-container';

/** Mocks the drawings list and opens the card for the specified drawing. */
async function openDrawingCard(page: Page, id: string, title: string) {
    await page.route('**/api/vault/drawings', (route) =>
        route.fulfill({
            json: [{ id, title, last_modified: '2026-06-01T10:00:00', size: 2048 }],
        })
    );
    await page.goto('/vault/drawing', { waitUntil: 'domcontentloaded' });
    const releaseNotesClose = page.locator(
        'button[aria-label="Close release notes"], button[aria-label="Tanca les notes de la versió"]'
    );
    await releaseNotesClose.first().click({ timeout: 10_000, force: true }).catch(() => {});
    const card = page.locator(`h3:has-text("${title}")`).first();
    // The Vault route is intentionally lazy-loaded and its first visit also
    // downloads the Tldraw/Mermaid chunks. A clean CI browser can need close
    // to a minute before the drawing cards are mounted.
    await card.waitFor({ state: 'visible', timeout: 75_000 });
    await releaseNotesClose.first().click({ timeout: 2_000, force: true }).catch(() => {});
    await card.click();
}

/**
 * Intercepts GET and PUT for the drawing. PUTs are recorded and responded to
 * with success WITHOUT touching the backend; GET delegates to the handler passed in.
 */
async function interceptDrawing(
    page: Page,
    id: string,
    onGet: (route: Route) => Promise<void>
): Promise<string[]> {
    const puts: string[] = [];
    await page.route(`**/api/vault/drawings/${id}`, async (route) => {
        if (route.request().method() === 'PUT') {
            puts.push(route.request().postData() || '');
            return route.fulfill({ json: { status: 'success', id } });
        }
        return onGet(route);
    });
    return puts;
}

test.describe('TldrawEditor: cap PUT destructiu si la càrrega falla', () => {
    test.describe.configure({ timeout: 180_000 });

    test('GET 500 ⇒ overlay, cap PUT, i el reintent recupera', async ({ page }) => {
        const ID = 'guard-e2e-500';
        let backendUp = false;
        const puts = await interceptDrawing(page, ID, async (route) => {
            if (backendUp) {
                return route.fulfill({ json: {} });
            }
            return route.fulfill({ status: 500, json: { detail: 'Error reading target file' } });
        });

        await openDrawingCard(page, ID, 'Guard 500');

        // Error overlay visible, with saving blocked
        await expect(page.getByText("No s'ha pogut carregar el dibuix")).toBeVisible({ timeout: 30_000 });

        // Neither autosave (1 s) nor Ctrl+S should be able to save
        await page.keyboard.press('ControlOrMeta+s');
        await page.waitForTimeout(3_000);
        expect(puts, 'cap PUT amb la càrrega fallida').toHaveLength(0);

        // The backend "comes back" → the retry must load the editor
        backendUp = true;
        await page.getByRole('button', { name: 'Torna-ho a provar' }).click();
        await expect(page.getByText("No s'ha pogut carregar el dibuix")).not.toBeVisible({ timeout: 30_000 });
        await expect(page.locator(CANVAS).first()).toBeVisible({ timeout: 60_000 });
    });

    test('format legacy Excalidraw ⇒ overlay incompatible i cap PUT (no eclipsa)', async ({ page }) => {
        const ID = 'guard-e2e-legacy';
        // The backend returns the .excalidraw.json JSON as-is: loadSnapshot from
        // tldraw does NOT throw an error with this format — it's a silent no-op.
        const puts = await interceptDrawing(page, ID, (route) =>
            route.fulfill({
                json: {
                    type: 'excalidraw',
                    version: 2,
                    elements: [{ id: 'rect-1', type: 'rectangle', x: 0, y: 0 }],
                    appState: {},
                },
            })
        );

        await openDrawingCard(page, ID, 'Guard Legacy');

        await expect(page.getByText('Format de dibuix no compatible')).toBeVisible({ timeout: 30_000 });

        await page.keyboard.press('ControlOrMeta+s');
        await page.waitForTimeout(3_000);
        expect(puts, 'cap PUT que eclipsi el fitxer legacy').toHaveLength(0);
    });

    test('dibuix nou: pan no desa (scope document); dibuixar sí', async ({ page }) => {
        const ID = 'guard-e2e-happy';
        const puts = await interceptDrawing(page, ID, (route) => route.fulfill({ json: {} }));

        await openDrawingCard(page, ID, 'Guard Happy');

        const canvas = page.locator(CANVAS).first();
        await expect(canvas).toBeVisible({ timeout: 60_000 });

        // The initial mount may generate at most one PUT (tldraw creates the
        // default document records in an empty store). We wait for it
        // to settle and take the baseline.
        await page.waitForTimeout(2_500);
        const baseline = puts.length;

        // Pan/zoom = scope 'session' ⇒ must NOT schedule any autosave
        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();
        const cx = box!.x + box!.width / 2;
        const cy = box!.y + box!.height / 2;
        await page.mouse.move(cx, cy);
        await page.mouse.wheel(0, 300);
        await page.mouse.wheel(0, -150);
        await page.waitForTimeout(2_000);
        expect(puts.length, 'el pan/zoom no ha de desar').toBe(baseline);

        // Drawing a stroke = 'document' scope ⇒ autosave in ~1 s
        await page.getByTestId('tools.draw').click();
        await expect(page.getByTestId('tools.draw')).toHaveAttribute('aria-pressed', 'true');
        await page.waitForTimeout(250);
        await page.mouse.move(cx - 120, cy - 40);
        await page.mouse.down();
        await page.mouse.move(cx + 120, cy + 60, { steps: 15 });
        await page.mouse.up();
        await expect.poll(() => puts.length, { timeout: 10_000 }).toBeGreaterThan(baseline);

        // The PUT must carry the stroke in the snapshot (not an empty canvas)
        const lastRawPut = puts.at(-1);
        if (lastRawPut === undefined) throw new Error('Expected a saved drawing request');
        const lastPut = requireJsonObject(JSON.parse(lastRawPut));
        expect(lastPut.title).toBe('Guard Happy');
        const data = requireJsonObject(lastPut.data);
        const document = requireJsonObject(data.document);
        const storeRecords = Object.keys(requireJsonObject(document.store));
        expect(storeRecords.some((k) => k.startsWith('shape:')), 'el snapshot du shapes').toBe(true);
    });
});
