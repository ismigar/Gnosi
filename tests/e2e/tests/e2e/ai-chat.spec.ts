import { test, expect, type Page } from '@playwright/test';

import { chatStreamRoute } from '../../support/api-routes.ts';

/**
 * AI Chat E2E: floating chat button is visible globally, opens panel, has textarea.
 *
 * The chat is a global component (not a route). Endpoint POST /api/chat is
 * intercepted to avoid burning real LLM credits during tests.
 */

test.describe('AI Chat', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/vault/plugins', (route) => route.fulfill({
      json: { enabled_builtin: ['ai-platform'], enabled_third_party: [], disabled: [], settings: {} },
    }));
    // Keep setup's real login and membership; model/data responses remain controlled fixtures.
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

    await page.route(chatStreamRoute, async (route) => {
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

  const chatLauncherRegex = /(obrir (?:xat|chat)|abrir chat|open chat|ouvrir le chat)/i;
  const openFloatingDock = (page: Page) => page.evaluate(() => {
    document.body.dataset.gnosiFloatingDock = 'open';
  });
  const chatTextarea = (page: Page) => page
    .locator('textarea[placeholder*="Escriu"], textarea[placeholder*="message"], textarea[placeholder*="Escribe"]')
    .first();
  const dismissReleaseNotes = async (page: Page) => {
    const closeButton = page.getByRole('button', {
      name: /close release notes|tanca les notes de la versió|cerrar las notas de la versión|fermer les notes de version/i,
    });
    if (await closeButton.isVisible()) await closeButton.click();
  };
  const openChatPanel = async (page: Page) => {
    await dismissReleaseNotes(page);
    const textarea = chatTextarea(page);
    await page.getByRole('button', { name: chatLauncherRegex }).click();
    if (!(await textarea.isVisible())) {
      await page.getByRole('button', { name: chatLauncherRegex }).click();
    }
    await expect(textarea).toBeVisible({ timeout: 5_000 });
    return textarea;
  };

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

    await openChatPanel(page);
  });

  test('typing into chat textarea updates value', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await openFloatingDock(page);

    const textarea = await openChatPanel(page);

    await textarea.fill('Test message from Playwright');
    await expect(textarea).toHaveValue('Test message from Playwright');
  });

  test('submitted message renders the terminal NDJSON response', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await openFloatingDock(page);
    const textarea = await openChatPanel(page);
    await textarea.fill('Hello assistant');
    await textarea.press('Enter');

    await expect(page.getByText('Mocked response from Playwright')).toBeVisible({ timeout: 5_000 });
  });

  test('shows live and saved response processing seconds', async ({ page }) => {
    let finishResponse: (() => void) | undefined;
    const responseReady = new Promise<void>((resolve) => { finishResponse = resolve; });
    await page.unroute(chatStreamRoute);
    await page.route(chatStreamRoute, async (route) => {
      await responseReady;
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: [
          JSON.stringify({ type: 'llm_selected', mode: 'agent_default', provider: 'test', model: 'test-model' }),
          JSON.stringify({ type: 'message', role: 'ai', content: 'Timed response', node: 'general' }),
          JSON.stringify({ type: 'done', has_response: true, message_count: 1 }),
          '',
        ].join('\n'),
      });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    const textarea = await openChatPanel(page);
    await textarea.fill('Time this response');
    await textarea.press('Enter');

    try {
      await expect(page.getByText(/(?:Understanding request|Entenent la petició|Entendiendo la petición|Compréhension de la demande).*?(?:[1-9]\d*(?:\.\d+)?|0\.[1-9]\d*) s/i)).toBeVisible();
    } finally {
      finishResponse?.();
    }
    await expect(page.getByText('Timed response')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/test-model · (?:[1-9]\d*(?:\.\d+)?|0\.[1-9]\d*) s/)).toBeVisible();
  });

  test('rewinds a complete turn through the canonical session endpoint', async ({ page }) => {
    await page.route('**/api/chat/sessions/**/rewind', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"messages":[]}',
      });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    const textarea = await openChatPanel(page);
    await textarea.fill('Undo this turn');
    await textarea.press('Enter');
    await expect(page.getByText('Mocked response from Playwright')).toBeVisible({ timeout: 5_000 });

    const rewindRequest = page.waitForRequest((request) => (
      request.method() === 'POST' && request.url().endsWith('/rewind')
    ));
    await page.getByRole('button', {
      name: /undo from this message|desfer des d'aquest missatge|deshacer desde este mensaje|annuler à partir de ce message/i,
    }).last().click();
    await expect(page.getByRole('dialog')).toContainText(/external|externes|externas|externes/i);
    await page.getByRole('button', {
      name: /undo messages|desfer els missatges|deshacer los mensajes|annuler les messages/i,
    }).click();
    await rewindRequest;

    await expect(page.getByText('Mocked response from Playwright')).toHaveCount(0);
    await expect(textarea).toHaveValue('Undo this turn');
  });

  test('a pending turn exposes cancellation and locks the agent selector', async ({ page }) => {
    await page.unroute(chatStreamRoute);
    await page.route(chatStreamRoute, async (route) => {
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
    const textarea = await openChatPanel(page);
    await textarea.fill('Pending request');
    await textarea.press('Enter');

    await expect(page.getByRole('button', { name: /cancel|cancel·la|cancelar|annuler/i })).toBeVisible();
    await expect(page.locator('.gnosi-floating-panel--chat select')).toBeDisabled();
  });

  test('session retention deletes the evicted backend checkpoint', async ({ page }) => {
    const deletedCheckpoint = page.waitForRequest(
      (request) => (
        request.method() === 'DELETE'
        && request.url().includes('/api/chat/sessions/gnosy/session-20')
      ),
      { timeout: 15_000 },
    );
    await page.addInitScript(() => {
      // Setup owns the identity and vault; seed that scope without replacing it.
      const storageScope = [
        localStorage.getItem('gnosi_active_vault') || 'default',
        localStorage.getItem('gnosi_workspace_id') || 'personal',
        localStorage.getItem('gnosi_user_id') || 'personal',
      ].join(':');
      const sessions = Array.from({ length: 21 }, (_, index) => ({
        id: `session-${index}`,
        title: `Session ${index}`,
        archived: false,
        agentId: 'gnosy',
        messages: [],
        createdAt: 1_000 - index,
        updatedAt: 1_000 - index,
      }));
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
