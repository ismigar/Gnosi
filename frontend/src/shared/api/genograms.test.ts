import { afterEach, expect, it, vi } from 'vitest';
import { requestAt, resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { fetchGenogramSetupStatus, genogramRequestContext, prepareGenograms } from './genograms';

afterEach(() => { resetApiTestStorage(); vi.unstubAllGlobals(); });

it('checks and prepares the selected vault without changing the active vault', async () => {
  writeApiTestStorage('gnosi_active_vault', 'active');
  writeApiTestStorage('gnosi_active_vault_slug', 'active-vault');
  writeApiTestStorage('gnosi_vault_catalog', JSON.stringify([
    { id: 'active', slug: 'active-vault' }, { id: 'selected', slug: 'selected-vault' },
  ]));
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({ ready: true }), {
    headers: { 'Content-Type': 'application/json' },
  })));
  vi.stubGlobal('fetch', fetchMock);
  await fetchGenogramSetupStatus('selected');
  await prepareGenograms('ca', 'selected');
  for (const index of [0, 1]) {
    const request = requestAt(fetchMock.mock.calls, index);
    expect(request.headers.get('X-Vault-ID')).toBe('selected');
    expect(new URL(request.url).pathname).toBe(`/api/vault/genograms/${index === 0 ? 'status' : 'prepare'}`);
  }
  expect(await requestAt(fetchMock.mock.calls, 1).json()).toEqual({ locale: 'ca' });
  expect(genogramRequestContext().vaultId).toBe('active');
});
