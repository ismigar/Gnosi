import { resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchBrainTableStatus, invalidateBrainTableStatus } from './brain';
import { fetchReferenceTable } from './literature-resources';
import { queryClient } from './query-client';
import { fetchSystemHealth, invalidateSystemHealth } from './system';
import { fetchVaultCatalog, invalidateVaultCatalog } from './vaults';

function responseFor(input: RequestInfo | URL): Response {
  const request = input instanceof Request ? input : new Request(input);
  const path = new URL(request.url).pathname;
  if (path === '/api/health') {
    return Response.json({
      gnosi_mode: 'personal', mode: 'FastAPI', require_auth: false,
      status: 'ok', vault_configured: true,
    });
  }
  if (path === '/api/vaults') return Response.json({ vaults: [] });
  if (path === '/api/vault/brain-table') {
    return Response.json({ configured: true, table_id: 'brain' });
  }
  if (path === '/api/vault/reference-table') {
    return Response.json({ configured: true, table_id: 'references' });
  }
  return Response.json({ detail: `Unexpected ${path}` }, { status: 500 });
}

function endpointCounts(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): Record<string, number> {
  return fetchMock.mock.calls.reduce<Record<string, number>>((counts, [input]) => {
    const request = input instanceof Request ? input : new Request(input);
    const path = new URL(request.url).pathname;
    counts[path] = (counts[path] ?? 0) + 1;
    return counts;
  }, {});
}

beforeEach(() => {
  queryClient.clear();
  resetApiTestStorage();
});

afterEach(() => {
  queryClient.clear();
  resetApiTestStorage();
  vi.unstubAllGlobals();
});

describe('bootstrap query coalescing', () => {
  it('makes one initial request per shared resource', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => Promise.resolve(responseFor(input)));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      fetchSystemHealth(), fetchSystemHealth(), fetchSystemHealth(),
      fetchVaultCatalog(), fetchVaultCatalog(), fetchVaultCatalog(),
      fetchBrainTableStatus(), fetchBrainTableStatus(),
      fetchReferenceTable(), fetchReferenceTable(),
    ]);

    expect(endpointCounts(fetchMock)).toEqual({
      '/api/health': 1,
      '/api/vault/brain-table': 1,
      '/api/vault/reference-table': 1,
      '/api/vaults': 1,
    });
  });

  it('invalidates explicit refreshes and separates vault-scoped data', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => Promise.resolve(responseFor(input)));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([fetchSystemHealth(), fetchVaultCatalog()]);
    await invalidateSystemHealth();
    await invalidateVaultCatalog();
    await Promise.all([fetchSystemHealth(), fetchVaultCatalog()]);

    writeApiTestStorage('gnosi_active_vault', 'vault-a');
    await Promise.all([fetchBrainTableStatus(), fetchReferenceTable()]);
    await Promise.all([fetchBrainTableStatus(), fetchReferenceTable()]);
    writeApiTestStorage('gnosi_active_vault', 'vault-b');
    await Promise.all([fetchBrainTableStatus(), fetchReferenceTable()]);
    await invalidateBrainTableStatus();
    await fetchBrainTableStatus();

    expect(endpointCounts(fetchMock)).toEqual({
      '/api/health': 2,
      '/api/vault/brain-table': 3,
      '/api/vault/reference-table': 2,
      '/api/vaults': 2,
    });
  });

  it('aborts one caller without cancelling another shared consumer', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      await gate;
      return responseFor(input);
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const cancelled = fetchSystemHealth(controller.signal);
    const surviving = fetchSystemHealth();
    controller.abort();
    release?.();

    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await expect(surviving).resolves.toMatchObject({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
