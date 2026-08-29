import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createVaultView,
  deleteVaultView,
  fetchVaultViewUsage,
  fetchVaultViews,
  reorderVaultViews,
  updateVaultView,
} from './vault-views';


interface RecordedFetch {
  readonly mock: {
    readonly calls: readonly (readonly [RequestInfo | URL, RequestInit?])[];
  };
}


function requestAt(fetchMock: RecordedFetch, index = 0): Request {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`Missing fetch call ${String(index)}`);
  return call[0] instanceof Request
    ? call[0]
    : new Request(call[0], call[1]);
}


function stubJson(payload: unknown) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(Response.json(payload)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


describe('Vault views API', () => {
  it('loads views with the optional table filter', async () => {
    const view = { id: 'view-1', table_id: 'table-1', name: 'Board' };
    const fetchMock = stubJson([view]);

    await expect(fetchVaultViews('table-1')).resolves.toEqual([view]);

    const request = requestAt(fetchMock);
    expect(request.method).toBe('GET');
    expect(new URL(request.url).searchParams.get('table_id')).toBe('table-1');
  });

  it('creates and updates a flexible saved-view payload', async () => {
    const view = {
      id: 'view-1',
      table_id: 'table-1',
      name: 'Board',
      filters: [{ field: 'status', value: 'Open' }],
    };
    const fetchMock = stubJson(view);

    await expect(createVaultView(view)).resolves.toEqual(view);
    await expect(updateVaultView('view-1', view)).resolves.toEqual(view);

    expect(requestAt(fetchMock, 0).method).toBe('POST');
    expect(requestAt(fetchMock, 1).method).toBe('PUT');
    await expect(requestAt(fetchMock, 1).clone().json()).resolves.toEqual(view);
  });

  it('loads usage, reorders and deletes through typed routes', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url.endsWith('/usage')) {
        return Promise.resolve(
          Response.json({ view_id: 'view-1', count: 0, pages: [] }),
        );
      }
      if (request.method === 'DELETE') {
        return Promise.resolve(Response.json({ status: 'success' }));
      }
      return Promise.resolve(
        Response.json({ ok: true, table_id: 'table-1', count: 1 }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVaultViewUsage('view-1')).resolves.toMatchObject({ count: 0 });
    await expect(
      reorderVaultViews({ table_id: 'table-1', ordered_ids: ['view-1'] }),
    ).resolves.toMatchObject({ count: 1 });
    await expect(deleteVaultView('view-1')).resolves.toEqual({ status: 'success' });

    expect(requestAt(fetchMock, 0).url).toContain('/views/view-1/usage');
    expect(requestAt(fetchMock, 1).url).toContain('/views/order');
    expect(requestAt(fetchMock, 2).method).toBe('DELETE');
  });
});
