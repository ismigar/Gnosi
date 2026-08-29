import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchVaultAliasIndex,
  fetchVaultGlobalIndex,
  fetchVaultTables,
} from './vaults';


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


describe('vault registry API', () => {
  it('loads table metadata with its optional database filter', async () => {
    const payload = [{ id: 'notes', name: 'Notes' }];
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVaultTables('brain')).resolves.toEqual(payload);

    const input: RequestInfo | URL | undefined = fetchMock.mock.calls[0]?.[0];
    if (!(input instanceof Request)) throw new Error('Expected a Request instance');
    expect(new URL(input.url).searchParams.get('database_id')).toBe('brain');
  });

  it('loads global page titles and aliases', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ page: 'Page title' }))
      .mockResolvedValueOnce(Response.json({ page: ['Alias'] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVaultGlobalIndex()).resolves.toEqual({ page: 'Page title' });
    await expect(fetchVaultAliasIndex()).resolves.toEqual({ page: ['Alias'] });
  });
});
