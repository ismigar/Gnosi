import { resetApiTestStorage } from '../../test/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createNotebook,
  deleteNotebook,
  fetchReferenceResources,
} from './notebooks';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


describe('notebooks API', () => {
  it('queries the typed resource catalog with facet filters', async () => {
    const payload = { facets: {}, items: [], page: 2, page_size: 50, total: 0 };
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(payload, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchReferenceResources({
      author: 'Ada Lovelace',
      notebookId: 'notebook-1',
      page: 2,
      resourceType: 'paper',
      tag: 'history',
    });
    const request = fetchMock.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    const url = new URL(request.url);
    expect(url.pathname).toBe('/api/notebooks/resources');
    expect(url.searchParams.get('author')).toBe('Ada Lovelace');
    expect(url.searchParams.get('notebook_id')).toBe('notebook-1');
    expect(url.searchParams.get('type')).toBe('paper');
  });


  it('creates a notebook with compatibility defaults', async () => {
    const payload = { id: 'notebook-1', title: 'Research' };
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(payload, { status: 201 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createNotebook({ resource_ids: ['resource-1'], title: 'Research' });
    const request = fetchMock.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    await expect(request.clone().json()).resolves.toEqual({
      conversation_mode: 'private_member',
      resource_ids: ['resource-1'],
      title: 'Research',
      visibility: 'private',
    });
  });


  it('accepts the intentional 204 delete response without parsing JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteNotebook('notebook-1')).resolves.toBeUndefined();
  });
});
