import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * AI Chat E2E: floating chat button is visible globally, opens panel, has textarea.
 *
 * The chat is a global component (not a route). Endpoint POST /api/chat is
 * intercepted to avoid burning real LLM credits during tests.
 */

test.describe('AI Chat', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/health', (route) => route.fulfill({
      json: { status: 'ok', gnosi_mode: 'personal', require_auth: false },
    }));
    await page.route('**/api/auth/me', (route) => route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Not authenticated' }),
    }));
    await page.addInitScript(() => {
      const openDock = () => {
        document.body.dataset.gnosiFloatingDock = 'open';
      };
      if (document.body) openDock();
      else document.addEventListener('DOMContentLoaded', openDock, { once: true });
    });

    await page.route('**/api/config', async (route) => {
      await route.fulfill({
        json: {
          ai: {
            active_agent_id: 'gnosy',
            agents: [{
              id: 'gnosy',
              name: 'Gnosi Test Agent',
              provider: 'test',
              model: 'test-model',
              enabled: true,
            }],
          },
        },
      });
    });
    for (const endpoint of ['/api/vault/pages', '/api/vault/tables', '/api/vault/databases']) {
      await page.route(`**${endpoint}`, (route) => route.fulfill({ json: [] }));
    }
    await page.route('**/api/chat/confirmations**', (route) => route.fulfill({ json: [] }));

    await page.route('**/api/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: [
          JSON.stringify({ type: 'llm_selected', mode: 'agent_default', provider: 'test', model: 'test-model' }),
          JSON.stringify({ type: 'message', role: 'ai', content: 'Mocked response from Playwright', node: 'general' }),
          JSON.stringify({ type: 'done', has_response: true, message_count: 1 }),
          '',
        ].join('\n'),
      });
    });
  });

  const chatLauncherRegex = /(obrir (?:chat|xat)|abrir chat|open chat|ouvrir le chat)/i;
  const openFloatingDock = (page: Page) => page.evaluate(() => {
    document.body.dataset.gnosiFloatingDock = 'open';
  });

  test('chat launcher button is present on home', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await openFloatingDock(page);

    const launcher = page.getByRole('button', { name: chatLauncherRegex });
    await expect(launcher).toBeVisible({ timeout: 10_000 });
  });

  test('chat panel opens with textarea on click', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await openFloatingDock(page);

    await page.getByRole('button', { name: chatLauncherRegex }).click();

    const textarea = page
      .locator('textarea[placeholder*="Escriu"], textarea[placeholder*="message"], textarea[placeholder*="Escribe"]')
      .first();
    await expect(textarea).toBeVisible({ timeout: 5_000 });
  });

  test('typing into chat textarea updates value', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await openFloatingDock(page);

    await page.getByRole('button', { name: chatLauncherRegex }).click();

    const textarea = page
      .locator('textarea[placeholder*="Escriu"], textarea[placeholder*="message"], textarea[placeholder*="Escribe"]')
      .first();
    await expect(textarea).toBeVisible({ timeout: 5_000 });

    await textarea.fill('Test message from Playwright');
    await expect(textarea).toHaveValue('Test message from Playwright');
  });

  test('submitted message renders the terminal NDJSON response', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await openFloatingDock(page);
    await page.getByRole('button', { name: chatLauncherRegex }).click();

    const textarea = page
      .locator('textarea[placeholder*="Escriu"], textarea[placeholder*="message"], textarea[placeholder*="Escribe"]')
      .first();
    await textarea.fill('Hello assistant');
    await textarea.press('Enter');

    await expect(page.getByText('Mocked response from Playwright')).toBeVisible({ timeout: 5_000 });
  });

  test('a pending turn exposes cancellation and locks the agent selector', async ({ page }) => {
    await page.unroute('**/api/chat');
    await page.route('**/api/chat', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: `${JSON.stringify({ type: 'done', has_response: false, message_count: 0 })}\n`,
      });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await openFloatingDock(page);
    await page.getByRole('button', { name: chatLauncherRegex }).click();

    const textarea = page
      .locator('textarea[placeholder*="Escriu"], textarea[placeholder*="message"], textarea[placeholder*="Escribe"]')
      .first();
    await textarea.fill('Pending request');
    await textarea.press('Enter');

    await expect(page.getByRole('button', { name: /cancel|cancel·la|cancelar|annuler/i })).toBeVisible();
    await expect(page.locator('.gnosi-floating-panel--chat select')).toBeDisabled();
  });

  test('session retention deletes the evicted backend checkpoint', async ({ page }) => {
    const deletedCheckpoint = page.waitForRequest((request) => (
      request.method() === 'DELETE'
      && request.url().includes('/api/chat/sessions/gnosy/session-20')
    ));
    await page.addInitScript(() => {
      const storageScope = 'retention-test:personal:personal';
      const sessions = Array.from({ length: 21 }, (_, index) => ({
        id: `session-${index}`,
        title: `Session ${index}`,
        archived: false,
        agentId: 'gnosy',
        messages: [],
        createdAt: 1_000 - index,
        updatedAt: 1_000 - index,
      }));
      localStorage.setItem('gnosi_active_vault', 'retention-test');
      localStorage.setItem(
        `agent_chat_sessions_v2:${storageScope}`,
        JSON.stringify(sessions),
      );
      localStorage.setItem(`agent_selected_id_v2:${storageScope}`, 'gnosy');
      localStorage.setItem(
        `agent_chat_active_session_id_v2:${storageScope}`,
        'session-0',
      );
      localStorage.setItem(`agent_session_id_v2:${storageScope}`, 'session-0');
    });
    await page.route('**/api/chat/sessions/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"deleted":true}' });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await deletedCheckpoint;
  });
});
