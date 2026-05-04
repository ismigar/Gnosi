import { test, expect } from '@playwright/test';

/**
 * E2E del flux d'inserció d'enllaç ric (modal RichLinkInsert).
 *
 * Cobreix:
 * 1. Slash menu obre el modal "Enllaç ric"
 * 2. Tab Local → mode "Enllaçar (file://)" insereix un enllaç inline correcte
 * 3. Click sobre l'enllaç file:// crida l'endpoint /api/vault/open-local-path
 *    (en lloc de deixar que el navegador obri nova pestanya buida)
 * 4. Cap regressió: el contingut existent es manté després d'inserir
 */

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

async function openFirstNote(page) {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');
    // Busca la primera nota disponible al sidebar
    const firstNoteLink = page.locator('[data-testid="sidebar-page"], aside a[href*="/vault/page/"]').first();
    await firstNoteLink.waitFor({ state: 'visible', timeout: 10000 });
    await firstNoteLink.click();
    await page.waitForSelector('.bn-editor', { timeout: 10000 });
}

test.describe('RichLinkInsert (slash menu /Enllaç ric)', () => {

    test('insereix un enllaç file:// i el clic crida open-local-path', async ({ page }) => {
        // Mock de l'endpoint perquè el test no depengui del shell del sistema
        let openCalledWith = null;
        await page.route('**/api/vault/open-local-path', async (route) => {
            openCalledWith = JSON.parse(route.request().postData() || '{}');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ status: 'ok', target: openCalledWith.path, kind: 'dir' }),
            });
        });

        await openFirstNote(page);

        // Captura el contingut inicial per verificar que NO es perd
        const editorBefore = await page.locator('.bn-editor').innerText();

        // 1. Posa el cursor a un block buit nou (Enter al final)
        await page.locator('.bn-editor').click();
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');

        // 2. Activa el slash menu i cerca "Enllaç ric"
        await page.keyboard.type('/');
        await page.waitForSelector('text=Enllaç ric', { timeout: 5000 });
        await page.click('text=Enllaç ric');

        // 3. El modal s'ha d'obrir amb el tab URL per defecte
        await expect(page.locator('text=URL')).toBeVisible();
        await expect(page.locator('text=Local')).toBeVisible();
        await expect(page.locator('text=Embed')).toBeVisible();

        // 4. Clica el tab Local
        await page.click('button[role="tab"]:has-text("Local")');

        // 5. Verifica el toggle entre "Enllaçar" i "Pujar"
        await expect(page.locator('text=Enllaçar (file://)')).toBeVisible();
        await expect(page.locator('text=Pujar a Assets')).toBeVisible();

        // 6. Mode "Enllaçar" és el default — enganxa la ruta
        const testPath = '/Users/test/Documents/Carpeta Test';
        await page.fill('input[placeholder*="document.pdf"]', testPath);
        await page.fill('input[placeholder*="Text mostrat"]', 'Carpeta Test');

        // 7. Clica "Inserir enllaç"
        await page.click('button:has-text("Inserir enllaç")');

        // 8. El modal s'ha de tancar i l'enllaç ha d'aparèixer al document
        await expect(page.locator('text=Inserir enllaç')).not.toBeVisible({ timeout: 3000 });
        const link = page.locator(`.bn-editor a[href="file://${testPath}"]`);
        await expect(link).toBeVisible({ timeout: 5000 });
        await expect(link).toHaveText('Carpeta Test');

        // 9. El contingut original NO s'ha perdut
        const editorAfter = await page.locator('.bn-editor').innerText();
        expect(editorAfter.length).toBeGreaterThanOrEqual(editorBefore.length);

        // 10. Click sobre l'enllaç → ha de cridar /api/vault/open-local-path
        await link.click();
        await page.waitForTimeout(500); // dóna temps a la crida fetch
        expect(openCalledWith).not.toBeNull();
        expect(openCalledWith.path).toBe(`file://${testPath}`);
    });

    test('mode embed insereix un block image quan la URL és una imatge', async ({ page }) => {
        await openFirstNote(page);

        await page.locator('.bn-editor').click();
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await page.keyboard.type('/');
        await page.waitForSelector('text=Enllaç ric', { timeout: 5000 });
        await page.click('text=Enllaç ric');

        await page.click('button[role="tab"]:has-text("Embed")');
        await page.fill('input[placeholder*="(imatge, vídeo, fitxer)"]', 'https://placehold.co/200x100.png');
        await page.click('button:has-text("Embed")');

        await expect(page.locator('.bn-editor img[src="https://placehold.co/200x100.png"]')).toBeVisible({ timeout: 5000 });
    });

    test('autosave: el contingut persisteix després de toggle MD ↔ vista normal', async ({ page }) => {
        await openFirstNote(page);

        // Escriu text que sigui detectable
        const marker = `marker-${Date.now()}`;
        await page.locator('.bn-editor').click();
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await page.keyboard.type(marker);

        // Espera l'autosave (el debounce és 700ms)
        await page.waitForTimeout(1500);

        // Toggle a MD
        const mdToggle = page.locator('button:has-text("MD")').first();
        await mdToggle.click();
        await page.waitForSelector('textarea', { timeout: 3000 });

        // El textarea ha de mostrar el marker, NO "[object Object]"
        const md = await page.locator('textarea').inputValue();
        expect(md).toContain(marker);
        expect(md).not.toContain('[object Object]');

        // Toggle a vista normal
        await mdToggle.click();
        await page.waitForSelector('.bn-editor', { timeout: 3000 });

        // El marker hi és (no s'ha perdut)
        const editorText = await page.locator('.bn-editor').innerText();
        expect(editorText).toContain(marker);
    });
});
