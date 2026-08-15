import { test, expect } from '@playwright/test';

/**
 * E2E test for the rich link insertion flow (RichLinkInsert modal).
 *
 * Covers:
 * 1. Slash menu opens the "Rich link" modal
 * 2. Local tab → "Link (file://)" mode inserts a correct inline link
 * 3. Clicking the file:// link calls the /api/vault/open-local-path endpoint
 *    (instead of letting the browser open a new empty tab)
 * 4. No regression: existing content is preserved after inserting
 */

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

async function openFirstNote(page) {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');
    // Look for the first available note in the sidebar
    const firstNoteLink = page.locator('[data-testid="sidebar-page"], aside a[href*="/vault/page/"]').first();
    await firstNoteLink.waitFor({ state: 'visible', timeout: 10000 });
    await firstNoteLink.click();
    await page.waitForSelector('.bn-editor', { timeout: 10000 });
}

test.describe('RichLinkInsert (slash menu /Enllaç ric)', () => {

    test('insereix un enllaç file:// i el clic crida open-local-path', async ({ page }) => {
        // Mock the endpoint so the test doesn't depend on the system shell
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

        // Capture the initial content to verify it is NOT lost
        const editorBefore = await page.locator('.bn-editor').innerText();

        // 1. Place the cursor in a new empty block (Enter at the end)
        await page.locator('.bn-editor').click();
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');

        // 2. Activate the slash menu and search for "Rich link"
        await page.keyboard.type('/');
        await page.waitForSelector('text=Enllaç ric', { timeout: 5000 });
        await page.click('text=Enllaç ric');

        // 3. The modal must open with the URL tab by default
        await expect(page.locator('text=URL')).toBeVisible();
        await expect(page.locator('text=Local')).toBeVisible();
        await expect(page.locator('text=Embed')).toBeVisible();

        // 4. Click the Local tab
        await page.click('button[role="tab"]:has-text("Local")');

        // 5. Verify the toggle between "Link" and "Upload"
        await expect(page.locator('text=Enllaçar (file://)')).toBeVisible();
        await expect(page.locator('text=Pujar a Assets')).toBeVisible();

        // 6. "Link" mode is the default — paste the path
        const testPath = '/Users/test/Documents/Carpeta Test';
        await page.fill('input[placeholder*="document.pdf"]', testPath);
        await page.fill('input[placeholder*="Text mostrat"]', 'Carpeta Test');

        // 7. Click "Insert link"
        await page.click('button:has-text("Inserir enllaç")');

        // 8. The modal should close and the link should appear in the document
        await expect(page.locator('text=Inserir enllaç')).not.toBeVisible({ timeout: 3000 });
        const link = page.locator(`.bn-editor a[href="file://${testPath}"]`);
        await expect(link).toBeVisible({ timeout: 5000 });
        await expect(link).toHaveText('Carpeta Test');

        // 9. The original content has NOT been lost
        const editorAfter = await page.locator('.bn-editor').innerText();
        expect(editorAfter.length).toBeGreaterThanOrEqual(editorBefore.length);

        // 10. Click the link → should call /api/vault/open-local-path
        await link.click();
        await page.waitForTimeout(500); // give the fetch call time to complete
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

        // Type text that is detectable
        const marker = `marker-${Date.now()}`;
        await page.locator('.bn-editor').click();
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await page.keyboard.type(marker);

        // Wait for autosave (the debounce is 700ms)
        await page.waitForTimeout(1500);

        // Toggle a MD
        const mdToggle = page.locator('button:has-text("MD")').first();
        await mdToggle.click();
        await page.waitForSelector('textarea', { timeout: 3000 });

        // The textarea should show the marker, NOT "[object Object]"
        const md = await page.locator('textarea').inputValue();
        expect(md).toContain(marker);
        expect(md).not.toContain('[object Object]');

        // Toggle to normal view
        await mdToggle.click();
        await page.waitForSelector('.bn-editor', { timeout: 3000 });

        // The marker is there (it hasn't been lost)
        const editorText = await page.locator('.bn-editor').innerText();
        expect(editorText).toContain(marker);
    });
});
