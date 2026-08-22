import { expect, test, type Page } from '@playwright/test';

const createNotebookPattern = /(crea un quadern|create notebook|crear cuaderno|créer un carnet)/i;
const chatPlaceholderPattern = /(pregunta.*fonts|question.*sources|pregunta.*fuentes|question.*sources)/i;

async function dismissReleaseNotes(page: Page) {
  const close = page.getByRole('button', {
    name: /close release notes|tanca les notes de la versió|cerrar las notas de la versión|fermer les notes de version/i,
  });
  if (await close.isVisible()) await close.click();
}

test('creates, ingests and refreshes a grounded PDF and web notebook', async ({ page, context }) => {
  test.setTimeout(90_000);
  let sourceVersion = 1;
  let detailReads = 0;
  let openRefreshRequests = 0;
  let notebookCreated = false;
  let cancelRequests = 0;
  let chatRequest: Record<string, unknown> | null = null;
  const selectedResourceIds: string[] = [];
  const retriedResourceIds: string[] = [];

  await page.route('**/api/health', (route) => route.fulfill({
    json: { status: 'ok', gnosi_mode: 'personal', require_auth: false },
  }));
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 401,
    json: { detail: 'Not authenticated' },
  }));
  await page.route('**/api/vault/plugins', (route) => route.fulfill({
    json: {
      enabled_builtin: ['ai-platform', 'grounded-notebooks'],
      enabled_third_party: [],
      disabled: [],
      settings: {},
    },
  }));
  await page.route('**/api/config', (route) => route.fulfill({
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
  }));
  for (const endpoint of ['/api/vault/pages', '/api/vault/tables', '/api/vault/databases']) {
    await page.route(`**${endpoint}`, (route) => route.fulfill({ json: [] }));
  }
  await page.route('**/api/chat/confirmations**', (route) => route.fulfill({
    json: { confirmations: [] },
  }));
  await context.route('https://sources.example/**', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<title>Grounded web source</title><p>Original evidence.</p>',
  }));

  await page.route('**/api/notebooks**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === '/api/notebooks/resources') {
      await route.fulfill({
        json: {
          items: [
            { id: 'resource-pdf', title: 'PDF evidence', source_count: 1 },
            { id: 'resource-web', title: 'Web evidence', source_count: 1 },
          ],
          total: 2,
          page: 1,
          page_size: 50,
          hidden_without_sources: 1,
          facets: { types: [], authors: [], tags: [] },
        },
      });
      return;
    }
    if (url.pathname === '/api/notebooks' && method === 'POST') {
      const payload = request.postDataJSON();
      selectedResourceIds.push(...payload.resource_ids);
      notebookCreated = true;
      detailReads = 0;
      await route.fulfill({
        status: 201,
        json: { id: 'notebook-e2e', title: payload.title },
      });
      return;
    }
    if (url.pathname === '/api/notebooks' && method === 'GET') {
      await route.fulfill({
        json: {
          items: notebookCreated ? [{
            id: 'notebook-e2e',
            title: 'Grounded E2E notebook',
            status: 'available',
            visibility: 'private',
            conversation_mode: 'private_member',
            resource_count: 2,
            source_counts: { total: 2, available: 2 },
          }] : [],
          total: notebookCreated ? 1 : 0,
          page: 1,
          page_size: 24,
        },
      });
      return;
    }
    if (url.pathname === '/api/notebooks/notebook-e2e/conversation') {
      await route.fulfill({ json: { messages: [], session_id: 'notebook-e2e-private' } });
      return;
    }
    if (url.pathname === '/api/notebooks/notebook-e2e/refresh/cancel' && method === 'POST') {
      cancelRequests += 1;
      detailReads = Math.max(detailReads, 1);
      await route.fulfill({
        json: {
          id: 'notebook-e2e',
          title: 'Grounded E2E notebook',
          status: 'available',
          active_revision: sourceVersion,
          visibility: 'private',
          conversation_mode: 'private_member',
          conversation_session_id: 'notebook-e2e-private',
          resource_count: 2,
          source_counts: { total: 2, available: 2 },
          chat_ready: true,
          can_manage: true,
          can_chat: true,
          progress: { state: 'cancelled', processed: 1, total: 2, percent: 50 },
          last_error: 'Indexing was cancelled by the notebook creator.',
        },
      });
      return;
    }
    const retryMatch = url.pathname.match(/^\/api\/notebooks\/notebook-e2e\/sources\/([^/]+)\/refresh$/);
    if (retryMatch && method === 'POST') {
      retriedResourceIds.push(decodeURIComponent(retryMatch[1]));
      await route.fulfill({ status: 202, json: { state: 'queued', revision: sourceVersion + 1 } });
      return;
    }
    if (url.pathname === '/api/notebooks/notebook-e2e/sources') {
      const ready = cancelRequests > 0;
      const activeRevision = ready ? sourceVersion : (sourceVersion > 1 ? sourceVersion - 1 : null);
      await route.fulfill({
        json: {
          items: ready ? [
            {
              resource_id: 'resource-pdf',
              title: 'PDF evidence',
              state: 'available',
              last_checked_at: '2026-08-21T10:00:00Z',
              sources: [{ source_id: 'pdf-1', kind: 'pdf', label: `evidence-v${sourceVersion}.pdf`, status: 'available' }],
            },
            {
              resource_id: 'resource-web',
              title: 'Web evidence',
              state: 'stale',
              error: 'The last valid web evidence is retained.',
              last_checked_at: '2026-08-21T10:00:00Z',
              sources: [{ source_id: 'web-1', kind: 'url', label: 'https://sources.example/article', status: 'stale', error: 'Origin temporarily unavailable.' }],
            },
          ] : [],
          total: 2,
          page: 1,
          page_size: 50,
          active_revision: activeRevision,
        },
      });
      return;
    }
    if (url.pathname === '/api/notebooks/notebook-e2e' && method === 'GET') {
      if (url.searchParams.get('refresh') === 'true') openRefreshRequests += 1;
      const ready = cancelRequests > 0;
      const activeRevision = ready ? sourceVersion : (sourceVersion > 1 ? sourceVersion - 1 : null);
      detailReads += 1;
      await route.fulfill({
        json: {
          id: 'notebook-e2e',
          title: 'Grounded E2E notebook',
          status: ready ? 'available' : 'indexing',
          active_revision: activeRevision,
          visibility: 'private',
          conversation_mode: 'private_member',
          conversation_session_id: 'notebook-e2e-private',
          resource_count: 2,
          source_counts: { total: ready ? 2 : 0, available: ready ? 2 : 0 },
          chat_ready: ready,
          can_manage: true,
          can_chat: true,
          progress: ready ? null : {
            state: 'indexing', processed: 1, total: 2, percent: 50,
            current_resource_title: 'Web evidence', cancellable: true,
          },
          last_error: null,
        },
      });
      return;
    }
    await route.fallback();
  });

  await page.route('**/api/chat', async (route) => {
    chatRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: [
        JSON.stringify({ type: 'llm_selected', mode: 'agent_default', provider: 'test', model: 'test-model' }),
        JSON.stringify({ type: 'tool_start', tool: 'search_notebook_context' }),
        JSON.stringify({ type: 'tool_end', tool: 'search_notebook_context' }),
        JSON.stringify({
          type: 'message',
          role: 'ai',
          content: 'The notebook evidence supports this grounded answer.',
          plan: { required_tool: 'search_notebook_context' },
          citations: {
            claim_count: 1,
            source_count: 1,
            claims: [{ claim_id: 'claim-1', text: 'Grounded answer', citation_ids: ['web-citation'] }],
            sources: [{
              citation_id: 'web-citation',
              title: 'Web evidence',
              href: 'https://sources.example/article',
            }],
          },
        }),
        JSON.stringify({ type: 'done', has_response: true, message_count: 1 }),
        '',
      ].join('\n'),
    });
  });

  await page.goto('/notebooks', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await dismissReleaseNotes(page);
  const createButton = page.getByRole('button', { name: createNotebookPattern }).first();
  await expect(createButton).toBeVisible({ timeout: 30_000 });
  await createButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(/(?:no es mostr(?:a|en)|not shown|no se muestra|n'est pas affichée).*1/i);
  await dialog.getByRole('button', { name: /PDF evidence/i }).click();
  await dialog.getByRole('button', { name: /Web evidence/i }).click();
  await dialog.getByRole('button', { name: createNotebookPattern }).click();

  await expect.poll(() => selectedResourceIds.sort()).toEqual(['resource-pdf', 'resource-web']);
  await expect(page.getByText(/Current Resource: Web evidence|Recurs actual: Web evidence|Recurso actual: Web evidence|Ressource actuelle : Web evidence/i)).toBeVisible();
  await page.getByRole('button', { name: /Cancel indexing|Cancel·la la indexació|Cancelar indexación|Annuler l'indexation/i }).click();
  await expect.poll(() => cancelRequests).toBe(1);
  await expect(page.getByText(/Revision 1|Revisió 1|Revisión 1|Révision 1/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Last checked|Darrera comprovació|Última comprobación|Dernière vérification/i).first()).toBeVisible();
  await page.getByRole('button', { name: /Retry Resource|Torna a intentar el Recurs|Reintentar Recurso|Réessayer la Ressource/i }).click();
  await expect.poll(() => retriedResourceIds).toEqual(['resource-web']);
  const textarea = page.getByPlaceholder(chatPlaceholderPattern);
  await expect(textarea).toBeVisible({ timeout: 10_000 });
  await textarea.fill('What do both sources support?');
  await textarea.press('Enter');

  await expect(page.getByText('The notebook evidence supports this grounded answer.')).toBeVisible();
  expect(chatRequest).toMatchObject({
    context_refs: [{ type: 'notebook', ref: 'notebook-e2e' }],
  });
  await expect(page.getByRole('link', { name: 'Web evidence' })).toBeVisible();
  const sourcePopup = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Web evidence' }).click();
  const openedSource = await sourcePopup;
  await expect(openedSource).toHaveTitle('Grounded web source');
  await openedSource.close();

  sourceVersion = 2;
  detailReads = 0;
  await page.goto('/notebooks', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('button', { name: /Grounded E2E notebook/i }).click();
  await expect(page.getByText(/Revision 2|Revisió 2|Revisión 2|Révision 2/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('evidence-v2.pdf')).toBeVisible();
  expect(openRefreshRequests).toBeGreaterThanOrEqual(2);
});
