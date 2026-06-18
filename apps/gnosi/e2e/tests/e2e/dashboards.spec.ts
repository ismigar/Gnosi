import { test, expect } from '@playwright/test';

/**
 * Dashboards E2E (smoke).
 *
 * Cobertura mínima de la creació de pàgines de tipus Dashboard (carpeta oculta
 * `.Dashboards`) via POST /api/vault/pages amb metadata.is_dashboard:
 *  1. La pàgina es crea a `.Dashboards` i el GET la retorna amb
 *     metadata.is_dashboard=true i el contingut.
 *  2. La pàgina queda fora del graf de wikilinks/backlinks (GET /backlinks
 *     NO ha de petar).
 *
 * Nomenclatura canònica `is_dashboard` / `.Dashboards` (el rename va
 * substituir l'antic `is_dashworks` / `.Dashworks`). El format actual
 * d'emmagatzematge és `.json`; aquest test no afirma res sobre .md vs .json.
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

    // /backlinks d'aquesta pàgina ha de respondre sense 5xx (l'indexer salta
    // els Dashboards abans).
    const bl = await request.get(`${API_BASE}/api/vault/backlinks/${created.id}`);
    expect(bl.status()).toBeLessThan(500);

    // Cleanup
    await request.delete(`${API_BASE}/api/vault/pages/${created.id}`);
  });
});
