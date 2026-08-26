import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PRODUCT_ROUTES = [
  '/',
  '/vault',
  '/graph',
  '/contacts',
  '/mail',
  '/calendar',
  '/reader',
  '/notebooks',
  '/social-dashboard',
  '/media',
  '/planning',
  '/dashboard',
];

const THEMES = ['light', 'dark'] as const;
const ENABLED_BUILTIN_PLUGINS = [
  'ai-platform',
  'automations',
  'calendar',
  'contacts',
  'feeds-reader',
  'grounded-notebooks',
  'mail',
  'project-planning',
  'social-publishing',
];

async function prepareTheme(page: Page, theme: typeof THEMES[number]) {
  await page.addInitScript((selectedTheme) => {
    localStorage.setItem('db-theme', selectedTheme);
  }, theme);
}

async function closeReleaseNotesIfPresent(page: Page) {
  const close = page.getByRole('button', {
    name: /close release notes|tanca les notes|cerrar las notas|fermer les notes/i,
  });
  await close.waitFor({ state: 'visible', timeout: 1_000 })
    .then(() => close.click())
    .catch(() => {});
}

async function openStableRoute(page: Page, route: string) {
  await page.route('**/api/vault/plugins', (request) => request.fulfill({
    json: {
      disabled: [],
      enabled_builtin: ENABLED_BUILTIN_PLUGINS,
      enabled_third_party: [],
      settings: {},
    },
  }));
  const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
  expect(response, `Navigation response missing for ${route}`).not.toBeNull();
  expect(response!.status(), `${route} should load successfully`).toBeLessThan(400);
  const appShell = page.locator('#page-content-scroll');
  await appShell.waitFor({ state: 'visible', timeout: 30_000 }).catch(async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(appShell).toBeVisible({ timeout: 30_000 });
  });
  await expect(page.locator('.gnosi-route-skeleton')).toHaveCount(0, { timeout: 60_000 });
  await closeReleaseNotesIfPresent(page);
  await page.waitForTimeout(250);
}

function axeFailureMessage(route: string, theme: string, violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  return [
    `Accessibility violations on ${route} (${theme}):`,
    ...violations.flatMap((violation) => [
      `${violation.id} [${violation.impact ?? 'unknown'}]: ${violation.help}`,
      ...violation.nodes.map((node) => `  ${node.target.join(' ')} — ${node.failureSummary ?? ''}`),
    ]),
  ].join('\n');
}

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test.describe('WCAG 2.2 AA product-route gate', () => {
  test.describe.configure({ timeout: 90_000 });
  for (const theme of THEMES) {
    for (const route of PRODUCT_ROUTES) {
      test(`${route} has no axe violations in ${theme} mode`, async ({ page }) => {
        const pageErrors = collectPageErrors(page);
        await prepareTheme(page, theme);
        await openStableRoute(page, route);
        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();

        expect(
          results.violations,
          axeFailureMessage(route, theme, results.violations),
        ).toEqual([]);
        expect(pageErrors, `Unhandled page errors on ${route} (${theme})`).toEqual([]);
      });
    }
  }
});

test.describe('keyboard, focus, names, and live-region contracts', () => {
  test.describe.configure({ timeout: 90_000 });
  test('app shell is keyboard-complete and announces route changes', async ({ page }) => {
    await prepareTheme(page, 'light');
    await openStableRoute(page, '/');

    const skipLink = page.getByTestId('skip-to-content');
    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
    const focusStyle = await skipLink.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    expect(focusStyle.outlineStyle).not.toBe('none');
    expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(2);

    await page.keyboard.press('Enter');
    await expect(page.locator('#page-content-scroll')).toBeFocused();

    const navigationControls = page.locator('#gnosi-global-navigation a, #gnosi-global-navigation button');
    const missingNames = await navigationControls.evaluateAll((controls) => controls
      .filter((control) => !control.getAttribute('aria-label')?.trim())
      .map((control) => control.outerHTML));
    expect(missingNames, 'Every global navigation control needs a localized aria-label').toEqual([]);

    const announcer = page.getByTestId('route-announcer');
    await expect(announcer).not.toHaveText('');
    await page.locator('#gnosi-global-navigation a[href="/graph"]').click();
    await expect(page).toHaveURL(/\/graph$/);
    await expect(announcer).toContainText(/graph|graf/i);
  });

  test('cancelable dialog traps focus, closes with Escape, and restores the opener', async ({ page }) => {
    await openStableRoute(page, '/');
    const opener = page.getByTestId('home-settings-card');
    await opener.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toHaveAccessibleName(/.+/);
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    const focusable = dialog.locator('button:visible, a[href]:visible, input:visible, select:visible, textarea:visible, [tabindex]:not([tabindex="-1"]):visible');
    expect(await focusable.count()).toBeGreaterThan(1);
    await focusable.last().focus();
    await page.keyboard.press('Tab');
    await expect(focusable.first()).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused({ timeout: 300 });
  });

  test('mobile navigation excludes hidden links, traps focus, and returns it on Escape', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openStableRoute(page, '/');

    const toggle = page.getByRole('button', { name: /toggle navigation|commuta|alternar|afficher.*navigation/i });
    const navigation = page.locator('#gnosi-global-navigation');
    await expect(navigation).toHaveAttribute('inert', '');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(navigation).not.toHaveAttribute('inert', '');
    expect(await navigation.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(navigation).toHaveAttribute('inert', '');
    await expect(toggle).toBeFocused();
  });

  test('responsive notebook tabs expose one panel and support roving keyboard focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/notebooks/pw-a11y?refresh=*', (route) => route.fulfill({
      json: {
        id: 'pw-a11y',
        title: 'Accessibility notebook',
        status: 'ready',
        active_revision: 1,
        progress: null,
        last_error: null,
        resource_count: 0,
        source_counts: { total: 0, available: 0 },
        can_manage: true,
        can_chat: false,
        chat_ready: false,
        visibility: 'private',
        conversation_mode: 'private_member',
        conversation_session_id: 'pw-a11y-session',
      },
    }));
    await page.route('**/api/notebooks/pw-a11y/sources?*', (route) => route.fulfill({
      json: { items: [], total: 0, page: 1, page_size: 50, active_revision: 1 },
    }));

    await openStableRoute(page, '/notebooks/pw-a11y');
    const tablist = page.getByRole('tablist', { name: /notebook|quadern|cuaderno|carnet/i });
    const tabs = tablist.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(0)).toHaveAttribute('tabindex', '0');
    await expect(tabs.nth(1)).toHaveAttribute('tabindex', '-1');
    await expect(page.getByRole('tabpanel')).toHaveCount(1);

    await tabs.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'notebook-chat-panel');
    await page.keyboard.press('End');
    await expect(tabs.nth(2)).toBeFocused();
    await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'notebook-settings-panel');
    await page.keyboard.press('Home');
    await expect(tabs.nth(0)).toBeFocused();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations, axeFailureMessage('/notebooks/pw-a11y', 'mobile', results.violations)).toEqual([]);
  });
});
