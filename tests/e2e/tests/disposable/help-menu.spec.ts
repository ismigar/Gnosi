import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { installDisposableNetwork, seedDisposableBrowser } from '../../support/disposable-web.ts';

for (const width of [1280, 390]) {
  test(`help menu stays usable at ${width}px`, async ({ context, page }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    const audit = await installDisposableNetwork(context);
    await seedDisposableBrowser(context);
    await page.goto('/@synthetic/knowledge');
    const release = page.getByRole('button', { name: /close release notes|tanca les notes|cerrar las notas|fermer les notes/i });
    await release.waitFor({ state: 'visible', timeout: 1000 }).then(() => release.click()).catch(() => {});
    if (width < 768) await page.locator('.app-sidebar-mobile-toggle').click();
    const trigger = page.locator('.app-help > button');
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.locator('.app-help__menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveCount(4);
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    await expect(menu.getByRole('menuitem').nth(2)).toHaveAttribute('href', /\/learn\/(?:ca\/)?pages-files\/$/);
    const results = await new AxeBuilder({ page }).include('.app-help').analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`help-${width}.png`) });
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitem').last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    if (width < 768) await expect(page.locator('.app-sidebar--open')).toBeVisible();
    expect(audit.externalRequests).toEqual([]);
    expect(audit.unknownApiRequests).toEqual([]);
  });
}
