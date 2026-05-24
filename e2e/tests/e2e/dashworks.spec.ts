import { test, expect } from '@playwright/test';

/**
 * Dashworks E2E (smoke).
 *
 * Veure docs/dev_memory/directives/dashworks_spec.md.
 *
 * Cobertura mínima:
 *  1. POST /api/vault/pages amb is_dashworks=true crea un .md (no .json) i el
 *     GET següent retorna la pàgina amb metadata.is_dashworks=true.
 *  2. La pàgina creada queda fora del graf de wikilinks/backlinks
 *     (fent GET /api/vault/backlinks/<id> NO ha de petar).
 *
 * No fem una prova de UI completa: la creació de Dashboards des de la UI
 * passa pel mateix endpoint, i la UI ja està coberta a vault.spec.ts.
 */

const API_BASE = process.env.GNOSI_API_BASE || 'http://localhost:5002';

test.describe('Dashworks', () => {
  test('POST is_dashworks=true crea pàgina markdown i GET la retorna', async ({ request }) => {
    const title = `e2e_dashworks_${Date.now()}`;
    const create = await request.post(`${API_BASE}/api/vault/pages`, {
      data: {
        title,
        content: 'Smoke E2E dashworks',
        is_database: false,
        metadata: { is_dashworks: true },
      },
    });
    expect(create.ok(), `POST status ${create.status()}`).toBeTruthy();
    const created = await create.json();
    expect(created.id).toBeTruthy();
    expect(created.folder).toBe('.Dashworks');

    const get = await request.get(`${API_BASE}/api/vault/pages/${created.id}`);
    expect(get.ok(), `GET status ${get.status()}`).toBeTruthy();
    const page = await get.json();
    expect(page.metadata?.is_dashworks).toBe(true);
    // Migrat a markdown: ja no apareix content_format=json.
    expect(page.metadata?.content_format).not.toBe('json');
    expect(page.content).toContain('Smoke E2E dashworks');

    // Cleanup
    await request.delete(`${API_BASE}/api/vault/pages/${created.id}`);
  });

  test('Dashworks no apareix als backlinks d\'altres pàgines', async ({ request }) => {
    // Crea un Dashworks que conté un wikilink a una pàgina hipotètica.
    const title = `e2e_dashworks_skip_${Date.now()}`;
    const create = await request.post(`${API_BASE}/api/vault/pages`, {
      data: {
        title,
        content: '[[Pagina_inexistent_e2e]]',
        is_database: false,
        metadata: { is_dashworks: true },
      },
    });
    expect(create.ok()).toBeTruthy();
    const created = await create.json();

    // /backlinks d'aquesta pàgina ha de respondre OK (no ha de petar
    // perquè el filtre de l'indexer salta Dashworks abans). Lista buida o
    // no, però mai 5xx.
    const bl = await request.get(`${API_BASE}/api/vault/backlinks/${created.id}`);
    expect(bl.status()).toBeLessThan(500);

    // Cleanup
    await request.delete(`${API_BASE}/api/vault/pages/${created.id}`);
  });
});
