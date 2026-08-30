import { resetApiTestStorage } from '../../test/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchVaultTags } from './vault-tags';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


describe('vault tags API', () => {
  it('loads the aggregated tag index', async () => {
    const payload = {
      tags: [{
        count: 1,
        name: 'research',
        pages: [{ id: 'page-1', title: 'Research' }],
      }],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(payload));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVaultTags()).resolves.toEqual(payload);
    const [input] = fetchMock.mock.calls[0] || [];
    const request = input instanceof Request
      ? input
      : new Request(new URL(String(input), window.location.origin));
    expect(new URL(request.url).pathname).toBe('/api/vault/tags');
  });
});
