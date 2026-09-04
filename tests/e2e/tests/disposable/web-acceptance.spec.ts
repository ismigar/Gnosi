import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import {
  installDisposableNetwork,
  seedDisposableBrowser,
  type DisposableNetworkAudit,
} from '../../support/disposable-web.ts';

const THEMES = ['light', 'dark'] as const;

async function closeReleaseNotes(page: Page) {
  const close = page.getByRole('button', {
    name: /close release notes|tanca les notes|cerrar las notas|fermer les notes/i,
  });
  await close.waitFor({ state: 'visible', timeout: 1_000 }).then(() => close.click()).catch(() => {});
}

function requireIsolatedNetwork(audit: DisposableNetworkAudit) {
  expect(audit.externalRequests, 'No request may leave loopback').toEqual([]);
  expect(audit.unknownApiRequests, 'Every API request needs an explicit synthetic contract').toEqual([]);
}

test.describe('disposable synthetic web acceptance', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 });

  let audit: DisposableNetworkAudit;
  let browserErrors: string[];

  test.beforeEach(async ({ context, page }) => {
    audit = await installDisposableNetwork(context);
    await seedDisposableBrowser(context);
    browserErrors = [];
    page.on('pageerror', error => browserErrors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
    });
  });

  test.afterEach(() => {
    expect(browserErrors, 'No uncaught page or console errors').toEqual([]);
  });

  for (const theme of THEMES) {
    test(`Knowledge loads synthetic content and is accessible in ${theme}`, async ({ page }, testInfo) => {
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem('db-theme', selectedTheme);
      }, theme);
      const started = Date.now();
      const response = await page.goto('/@synthetic/knowledge', { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBe(200);
      await expect(page.locator('.vault-shell__main')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.gnosi-route-skeleton')).toHaveCount(0, { timeout: 30_000 });
      await closeReleaseNotes(page);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations).toEqual([]);

      await page.getByText(/^WIKI$/i).click();
      const syntheticNote = page.getByText('Synthetic acceptance note', { exact: true }).first();
      await expect(syntheticNote).toBeVisible();
      await syntheticNote.click();
      await expect(page).toHaveURL(/\/@synthetic\/knowledge\/page\/synthetic-page$/);
      await expect(page.getByText('Disposable knowledge content', { exact: true }).first())
        .toBeVisible({ timeout: 10_000 });
      const editorResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(editorResults.violations).toEqual([]);
      await testInfo.attach('knowledge-readiness.json', {
        body: JSON.stringify({ milliseconds: Date.now() - started }),
        contentType: 'application/json',
      });
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);
      requireIsolatedNetwork(audit);
    });
  }

  test('priority navigation reaches Knowledge, Calendar, Mail and Contacts surfaces', async ({ page }) => {
    await page.goto('/@synthetic/knowledge', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.vault-shell__main')).toBeVisible({ timeout: 30_000 });
    await closeReleaseNotes(page);

    const routes = [
      { path: '/@synthetic/calendar', surface: '.fc' },
      { path: '/@synthetic/mail', surface: '.mail-workspace' },
      { path: '/@synthetic/contacts', surface: '.contacts-split' },
      { path: '/@synthetic/knowledge', surface: '.vault-shell__main' },
    ];
    for (const { path, surface } of routes) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(path);
      await expect(page.locator(surface)).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.gnosi-route-skeleton')).toHaveCount(0, { timeout: 30_000 });
    }
    requireIsolatedNetwork(audit);
  });

  test('theme switch persists across a Knowledge reload', async ({ page }) => {
    await page.addInitScript(() => {
      if (localStorage.getItem('db-theme') === null) localStorage.setItem('db-theme', 'light');
    });
    await page.goto('/@synthetic/knowledge', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.vault-shell__main')).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => {
      localStorage.setItem('db-theme', 'dark');
      window.dispatchEvent(new StorageEvent('storage', { key: 'db-theme', newValue: 'dark' }));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expect(page.locator('.vault-shell__main')).toBeVisible({ timeout: 30_000 });
    requireIsolatedNetwork(audit);
  });

  test('external requests are actively blocked before transport', async ({ page }) => {
    const outcome = await page.evaluate(async () => {
      try {
        await fetch('https://web-acceptance.example.invalid/blocked-probe');
        return 'resolved';
      } catch {
        return 'blocked';
      }
    });
    expect(outcome).toBe('blocked');
    expect(audit.externalRequests).toEqual([
      'GET https://web-acceptance.example.invalid/blocked-probe',
    ]);
    expect(audit.unknownApiRequests).toEqual([]);
    expect(browserErrors).toHaveLength(1);
    expect(browserErrors[0]).toContain('ERR_BLOCKED_BY_CLIENT');
    browserErrors = [];
  });
});
