import { resetApiTestStorage } from '../../test/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createMediaView,
  deleteMediaView,
  fetchMediaPage,
  fetchMediaRoots,
  fetchMediaTree,
  fetchMediaViews,
  updateMediaMetadata,
  updateMediaView,
  uploadMediaFile,
} from './media-browser';


afterEach(() => {
  resetApiTestStorage();
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


  it('manages saved views, metadata and multipart gallery uploads', async () => {
    const view = {
      created_at: '2026-08-29T06:00:00Z',
      filters: { datePreset: 'all', kinds: [], mtimeFrom: '', mtimeTo: '', q: '', sizePreset: 'all', tagsAny: [] },
      id: 'view-1',
      label: 'Research',
      scope: { album: 'Papers', root: 'library' },
      sort: { dir: 'desc', field: 'mtime' },
      updated_at: '2026-08-29T06:00:00Z',
    };
    const upload = {
      album: 'Papers',
      date_taken: null,
      description: '',
      extension: '.png',
      filename: 'diagram.png',
      id: 'media-1',
      kind: 'image',
      last_modified: '2026-08-29T06:00:00Z',
      location: null,
      path: 'Images/Papers/diagram.png',
      path_in_root: 'Papers/diagram.png',
      root: 'images',
      size: 3,
      tags: [],
      url: '/api/vault/images/Papers/diagram.png',
    };
    const viewInput = {
      filters: view.filters,
      label: view.label,
      scope: view.scope,
      sort: view.sort,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([view]))
      .mockResolvedValueOnce(Response.json(view))
      .mockResolvedValueOnce(Response.json(view))
      .mockResolvedValueOnce(Response.json({ status: 'ok' }))
      .mockResolvedValueOnce(Response.json({ status: 'ok' }))
      .mockResolvedValueOnce(Response.json(upload));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMediaViews()).resolves.toEqual([view]);
    await expect(createMediaView(viewInput)).resolves.toEqual(view);
    await expect(updateMediaView('view-1', viewInput)).resolves.toEqual(view);
    await expect(deleteMediaView('view-1')).resolves.toEqual({ status: 'ok' });
    await expect(updateMediaMetadata({
      album: 'Papers',
      filename: 'diagram.png',
      metadata: { description: 'Architecture', tags: ['research'] },
      path_in_root: 'Papers/diagram.png',
      root: 'images',
    })).resolves.toEqual({ status: 'ok' });
    await expect(uploadMediaFile(new File(['png'], 'diagram.png'), 'Papers')).resolves.toEqual(
      upload,
    );

    const createRequest = fetchMock.mock.calls[1]?.[0];
    if (!(createRequest instanceof Request)) throw new Error('Expected a Request');
    await expect(createRequest.json()).resolves.toEqual(viewInput);
    const metadataRequest = fetchMock.mock.calls[4]?.[0];
    if (!(metadataRequest instanceof Request)) throw new Error('Expected a Request');
    await expect(metadataRequest.json()).resolves.toMatchObject({
      path_in_root: 'Papers/diagram.png',
      root: 'images',
    });
    const [uploadInput, uploadInit] = fetchMock.mock.calls[5] ?? [];
    expect(typeof uploadInput).toBe('string');
    if (typeof uploadInput !== 'string') throw new Error('Expected a string URL');
    expect(uploadInput).toContain('/api/vault/media/upload?album=Papers');
    expect(uploadInit?.body).toBeInstanceOf(FormData);
  });
});
