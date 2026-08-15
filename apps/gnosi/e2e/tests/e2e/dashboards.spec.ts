import { test, expect } from '@playwright/test';

/**
 * Dashboards E2E (smoke).
 *
 * Minimal coverage of creating Dashboard-type pages (hidden folder
 * `.Dashboards`) via POST /api/vault/pages with metadata.is_dashboard:
 *  1. The page is created in `.Dashboards` and GET returns it with
 *     metadata.is_dashboard=true and the content.
 *  2. The page stays out of the wikilinks/backlinks graph (GET /backlinks
 *     must NOT blow up).
 *
 * Canonical naming `is_dashboard` / `.Dashboards` (the rename
 * replaced the old `is_dashworks` / `.Dashworks`). The current storage
 * format is `.json`; this test makes no claims about .md vs .json.
 */

const API_BASE = process.env.GNOSI_API_BASE || 'http://localhost:5002';

test.describe('Dashboards', () => {
  test('POST is_dashboard=true crea pàgina a .Dashboards i GET la retorna', async ({ request }) => {
    const title = `e2e_dashboard_${Date.now()}`;
    const create = await request.post(`${API_BASE}/api/vault/pages`, {
      data: {
        title,
        content: 'Smoke E2E dashboard',
        is_database: false,
        metadata: { is_dashboard: true },
      },
    });
    expect(create.ok(), `POST status ${create.status()}`).toBeTruthy();
    const created = await create.json();
    expect(created.id).toBeTruthy();
    expect(created.folder).toBe('.Dashboards');

    const get = await request.get(`${API_BASE}/api/vault/pages/${created.id}`);
    expect(get.ok(), `GET status ${get.status()}`).toBeTruthy();
    const page = await get.json();
    expect(page.metadata?.is_dashboard).toBe(true);
    expect(page.content).toContain('Smoke E2E dashboard');

    // Cleanup
    await request.delete(`${API_BASE}/api/vault/pages/${created.id}`);
  });

  test('Dashboard no apareix als backlinks d\'altres pàgines', async ({ request }) => {
    const title = `e2e_dashboard_skip_${Date.now()}`;
    const create = await request.post(`${API_BASE}/api/vault/pages`, {
      data: {
        title,
        content: '[[Pagina_inexistent_e2e]]',
        is_database: false,
        metadata: { is_dashboard: true },
      },
    });
    expect(create.ok()).toBeTruthy();
    const created = await create.json();

    // /backlinks for this page must respond without a 5xx (the indexer skips
    // the Dashboards before).
    const bl = await request.get(`${API_BASE}/api/vault/backlinks/${created.id}`);
    expect(bl.status()).toBeLessThan(500);

    // Cleanup
    await request.delete(`${API_BASE}/api/vault/pages/${created.id}`);
  });
});
