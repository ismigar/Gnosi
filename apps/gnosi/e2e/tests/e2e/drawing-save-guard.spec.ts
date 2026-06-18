import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * TldrawEditor — guarda d'integritat del desat (directiva tldraw_save_integrity.md).
 *
 * El bug que cobreix: si el GET del dibuix fallava (500, OneDrive online-only)
 * o el snapshot no s'aplicava (legacy .excalidraw.json), el component tractava
 * l'error com a "dibuix nou" i l'autosave d'1 s SOBREESCRIVIA el fitxer real
 * amb un llenç buit.
 *
 * Cobreix:
 * 1. GET 500 ⇒ overlay d'error, CAP PUT (ni autosave ni Ctrl+S); el botó
 *    "Torna-ho a provar" recupera l'editor quan el backend torna.
 * 2. GET amb JSON d'Excalidraw (legacy) ⇒ overlay d'incompatible, CAP PUT
 *    (el .tldraw.json buit ja no eclipsa el fitxer legacy).
 * 3. Dibuix nou ({}): pan/zoom NO programa cap PUT (autosave filtrat per
 *    scope 'document'); dibuixar un traç SÍ que desa, amb shapes al snapshot.
 *
 * Tot mockejat amb page.route: el test no crea ni toca cap dibuix real.
 */

const CANVAS = '.tl-container';

/** Mockeja la llista de dibuixos i obre la card del dibuix indicat. */
async function openDrawingCard(page: Page, id: string, title: string) {
    await page.route('**/api/vault/drawings', (route) =>
        route.fulfill({
            json: [{ id, title, last_modified: '2026-06-01T10:00:00', size: 2048 }],
        })
    );
    await page.goto('/vault/drawing', { waitUntil: 'domcontentloaded' });
    const card = page.locator(`h3:has-text("${title}")`).first();
    await card.waitFor({ state: 'visible', timeout: 15_000 });
    await card.click();
}

/**
 * Intercepta GET i PUT del dibuix. Els PUT es registren i es responen amb
 * èxit SENSE tocar el backend; el GET delega en el handler passat.
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
    test.describe.configure({ timeout: 60_000 });

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

        // Overlay d'error visible, amb el desat bloquejat
        await expect(page.getByText("No s'ha pogut carregar el dibuix")).toBeVisible({ timeout: 15_000 });

        // Ni l'autosave (1 s) ni Ctrl+S no han de poder desar
        await page.keyboard.press('ControlOrMeta+s');
        await page.waitForTimeout(3_000);
        expect(puts, 'cap PUT amb la càrrega fallida').toHaveLength(0);

        // El backend "torna" → el reintent ha de carregar l'editor
        backendUp = true;
        await page.getByRole('button', { name: 'Torna-ho a provar' }).click();
        await expect(page.getByText("No s'ha pogut carregar el dibuix")).not.toBeVisible({ timeout: 10_000 });
        await expect(page.locator(CANVAS).first()).toBeVisible({ timeout: 15_000 });
    });

    test('format legacy Excalidraw ⇒ overlay incompatible i cap PUT (no eclipsa)', async ({ page }) => {
        const ID = 'guard-e2e-legacy';
        // El backend retorna el JSON .excalidraw.json tal qual: loadSnapshot de
        // tldraw NO llança error amb aquest format — és un no-op silenciós.
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

        await expect(page.getByText('Format de dibuix no compatible')).toBeVisible({ timeout: 15_000 });

        await page.keyboard.press('ControlOrMeta+s');
        await page.waitForTimeout(3_000);
        expect(puts, 'cap PUT que eclipsi el fitxer legacy').toHaveLength(0);
    });

    test('dibuix nou: pan no desa (scope document); dibuixar sí', async ({ page }) => {
        const ID = 'guard-e2e-happy';
        const puts = await interceptDrawing(page, ID, (route) => route.fulfill({ json: {} }));

        await openDrawingCard(page, ID, 'Guard Happy');

        const canvas = page.locator(CANVAS).first();
        await expect(canvas).toBeVisible({ timeout: 15_000 });

        // El muntatge inicial pot generar com a màxim un PUT (tldraw crea els
        // registres per defecte del document en un store buit). Esperem que
        // s'assenti i prenem la línia de base.
        await page.waitForTimeout(2_500);
        const baseline = puts.length;

        // Pan/zoom = scope 'session' ⇒ NO ha de programar cap autosave
        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();
        const cx = box!.x + box!.width / 2;
        const cy = box!.y + box!.height / 2;
        await page.mouse.move(cx, cy);
        await page.mouse.wheel(0, 300);
        await page.mouse.wheel(0, -150);
        await page.waitForTimeout(2_000);
        expect(puts.length, 'el pan/zoom no ha de desar').toBe(baseline);

        // Dibuixar un traç = scope 'document' ⇒ autosave en ~1 s
        await page.getByTestId('tools.draw').click();
        await page.mouse.move(cx - 120, cy - 40);
        await page.mouse.down();
        await page.mouse.move(cx + 120, cy + 60, { steps: 15 });
        await page.mouse.up();
        await expect.poll(() => puts.length, { timeout: 6_000 }).toBeGreaterThan(baseline);

        // El PUT ha de portar el traç al snapshot (no un llenç buit)
        const lastPut = JSON.parse(puts[puts.length - 1]);
        expect(lastPut.title).toBe('Guard Happy');
        const storeRecords = Object.keys(lastPut?.data?.document?.store ?? {});
        expect(storeRecords.some((k) => k.startsWith('shape:')), 'el snapshot du shapes').toBe(true);
    });
});
