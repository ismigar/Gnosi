import { test, expect, type Page } from '@playwright/test';

/**
 * Visual regression: pixel-diff against a baseline screenshot.
 *
 * First run creates baselines under tests/visual/regression.spec.ts-snapshots/.
 * Subsequent runs compare; failures dump diffs to test-results/.
 *
 * Update baselines deliberately: `npx playwright test --update-snapshots`.
 *
 * Animations are disabled (config) to keep diffs deterministic.
 */

const ROUTES = [
  { path: '/', name: 'home' },
  { path: '/vault', name: 'vault' },
  { path: '/calendar', name: 'calendar' },
  { path: '/contacts', name: 'contacts' },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'mobile', width: 390, height: 844 },
];

const DYNAMIC_MASKS: Record<string, string> = {
  '/': '.gnosi-vault-badge',
  '/vault': '.vault-shell__sidebar-content',
  '/calendar': [
    '.gnosi-vault-badge',
    '.app-header__title',
    '.calendar-workspace__canvas',
    '.calendar-workspace__sidebar-content',
  ].join(', '),
  '/contacts': '.gnosi-vault-badge, .contact-list__items',
};

const READY_SELECTORS: Record<string, string> = {
  '/': '.home-page',
  '/vault': '.vault-shell',
  '/calendar': '.calendar-workspace',
  '/contacts': '.contacts-split',
};

type VisualViewport = (typeof VIEWPORTS)[number];

async function prepareVisualState(page: Page, route: string, viewport: VisualViewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.evaluate(() => {
    localStorage.setItem('i18nextLng', 'en');
    localStorage.setItem('db-theme', 'light');
  });
  await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator(READY_SELECTORS[route]).waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
}

for (const { path: route, name } of ROUTES) {
  for (const viewport of VIEWPORTS) {
    test(`visual: ${name} (${viewport.name})`, async ({ page }) => {
      await prepareVisualState(page, route, viewport);

      await expect(page).toHaveScreenshot(`${name}-${viewport.name}.png`, {
        fullPage: false,
        mask: [
          page.locator(`time, [data-time], .fc-toolbar-title, ${DYNAMIC_MASKS[route]}`),
        ],
      });
    });
  }
}
