import { resetApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchSyncedBlock, saveSyncedBlock } from './synced-blocks';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


describe('synced blocks API', () => {
  it('loads and saves one encoded synced block', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ content: 'Before', sync_id: 'shared/block' }),
      )
      .mockResolvedValueOnce(
        Response.json({ content: 'After', saved: true, sync_id: 'shared/block' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await fetchSyncedBlock('shared/block');
    await saveSyncedBlock('shared/block', 'After');

    const requests = fetchMock.mock.calls.map(([input]) => {
      if (!(input instanceof Request)) throw new Error('Expected a Request');
      return input;
    });
    expect(new URL(requests[0]?.url || '').pathname).toBe(
      '/api/vault/synced/shared%2Fblock',
    );
    expect(requests[1]?.method).toBe('PUT');
    await expect(requests[1]?.clone().json()).resolves.toEqual({ content: 'After' });
  });
});
