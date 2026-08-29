import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchMediaPage,
  fetchMediaRoots,
  fetchMediaTree,
} from './media-browser';


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


describe('media browser API', () => {
  it('loads roots, a lazy tree, and a filtered media page', async () => {
    const roots = [
      {
        available: true,
        key: 'library',
        label: 'Library',
        url_prefix: '/api/vault/library/',
      },
    ];
    const tree = [{ has_children: true, name: 'Papers', path: 'Papers' }];
    const page = { items: [], limit: 200, offset: 0, root: 'library', total: 0 };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(roots))
      .mockResolvedValueOnce(Response.json(tree))
      .mockResolvedValueOnce(Response.json(page));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMediaRoots()).resolves.toEqual(roots);
    await expect(fetchMediaTree('library', 'Papers & Notes')).resolves.toEqual(tree);
    await expect(fetchMediaPage({
      album: 'Papers & Notes',
      limit: 200,
      offset: 0,
      root: 'library',
    })).resolves.toEqual(page);

    const treeRequest = fetchMock.mock.calls[1]?.[0];
    if (!(treeRequest instanceof Request)) throw new Error('Expected a Request');
    const treeUrl = new URL(treeRequest.url);
    expect(treeUrl.searchParams.get('root')).toBe('library');
    expect(treeUrl.searchParams.get('path')).toBe('Papers & Notes');

    const pageRequest = fetchMock.mock.calls[2]?.[0];
    if (!(pageRequest instanceof Request)) throw new Error('Expected a Request');
    const pageUrl = new URL(pageRequest.url);
    expect(pageUrl.searchParams.get('album')).toBe('Papers & Notes');
    expect(pageUrl.searchParams.get('limit')).toBe('200');
    expect(pageUrl.searchParams.get('offset')).toBe('0');
  });
});
