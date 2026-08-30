import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAt, resetApiTestStorage } from '../../test/api-request';
import {
  createVaultPage,
  deleteVaultPage,
  fetchVaultPage,
  fetchVaultPagePreview,
  fetchVaultPages,
  fetchVaultPagesByTable,
  fetchVaultTablePagesSnapshot,
  patchVaultPage,
  saveVaultPage,
  warmVaultPagePreviews,
} from './vaults';

afterEach(() => { resetApiTestStorage(); vi.unstubAllGlobals(); });

describe('vault pages API', () => {
  it('loads page lists and details with exact query, path and abort signal', async () => {
    const pages = [{ id: 'page-1', title: 'Page one' }];
    const page = { content: '# Page one', id: 'page-1', title: 'Page one' };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(pages))
      .mockResolvedValueOnce(Response.json(page));
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    await expect(
      fetchVaultPages(
        { folder: 'Projects', limit: 25, offset: 5, only_calendar: true },
        controller.signal,
      ),
    ).resolves.toEqual(pages);
    await expect(fetchVaultPage('page-1', controller.signal)).resolves.toEqual(page);

    const listRequest = requestAt(fetchMock.mock.calls, 0);
    const listUrl = new URL(listRequest.url);
    expect(listUrl.pathname).toBe('/api/vault/pages');
    expect(Object.fromEntries(listUrl.searchParams)).toEqual({
      folder: 'Projects',
      limit: '25',
      offset: '5',
      only_calendar: 'true',
    });

    const pageRequest = requestAt(fetchMock.mock.calls, 1);
    expect(new URL(pageRequest.url).pathname).toBe('/api/vault/pages/page-1');
    controller.abort();
    expect(listRequest.signal.aborted).toBe(true);
    expect(pageRequest.signal.aborted).toBe(true);
  });


  it('loads table pages and their canonical snapshot', async () => {
    const pages = [{ id: 'page-1', title: 'Page one' }];
    const snapshot = {
      pages,
      raw_count: 1,
      table_id: 'table-1',
      visible_count: 1,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(pages))
      .mockResolvedValueOnce(Response.json(snapshot));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchVaultPagesByTable('table-1', { include_templates: false }),
    ).resolves.toEqual(pages);
    await expect(fetchVaultTablePagesSnapshot('table-1')).resolves.toEqual(snapshot);

    const pagesUrl = new URL(requestAt(fetchMock.mock.calls, 0).url);
    expect(pagesUrl.pathname).toBe('/api/vault/pages/by-table/table-1');
    expect(pagesUrl.searchParams.get('include_templates')).toBe('false');
    expect(new URL(requestAt(fetchMock.mock.calls, 1).url).pathname).toBe(
      '/api/vault/pages/by-table/table-1/snapshot',
    );
  });


  it('loads full previews and warms their cache with exact payloads', async () => {
    const preview = {
      body_md: '# Preview',
      excerpt: 'Preview',
      id: 'page-1',
      images: [],
      title: 'Page one',
    };
    const warmed = { cached: 1, failed: 0, requested: 2, warmed: 1 };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(preview))
      .mockResolvedValueOnce(Response.json(warmed));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVaultPagePreview('page-1', { full: true })).resolves.toEqual(
      preview,
    );
    await expect(
      warmVaultPagePreviews({ ids: ['page-1', 'page-2'] }),
    ).resolves.toEqual(warmed);

    const previewRequest = requestAt(fetchMock.mock.calls, 0);
    const previewUrl = new URL(previewRequest.url);
    expect(previewUrl.pathname).toBe('/api/vault/pages/page-1/preview');
    expect(previewUrl.searchParams.get('full')).toBe('true');

    const warmRequest = requestAt(fetchMock.mock.calls, 1);
    expect(warmRequest.method).toBe('POST');
    expect(new URL(warmRequest.url).pathname).toBe(
      '/api/vault/pages/preview/warm',
    );
    await expect(warmRequest.json()).resolves.toEqual({
      ids: ['page-1', 'page-2'],
    });
  });


  it('materializes page defaults and sends typed page mutations', async () => {
    const created = { id: 'page-1', message: 'created', status: 'ok' };
    const saved = { id: 'page-1', message: 'saved', status: 'ok' };
    const patched = { id: 'page-1', message: 'patched', status: 'ok' };
    const deleted = {
      id: 'page-1',
      retention_days: 90,
      status: 'soft_deleted',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(created))
      .mockResolvedValueOnce(Response.json(saved))
      .mockResolvedValueOnce(Response.json(patched))
      .mockResolvedValueOnce(Response.json(deleted));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createVaultPage({ content: '', title: 'New page' }),
    ).resolves.toEqual(created);
    await expect(
      saveVaultPage('page-1', {
        content: '# Saved',
        force: true,
        metadata: { type: 'note' },
        title: 'Saved page',
      }),
    ).resolves.toEqual(saved);
    await expect(
      patchVaultPage('page-1', { metadata: { archived: true } }),
    ).resolves.toEqual(patched);
    await expect(deleteVaultPage('page-1')).resolves.toEqual(deleted);

    const createRequest = requestAt(fetchMock.mock.calls, 0);
    expect(createRequest.method).toBe('POST');
    expect(new URL(createRequest.url).pathname).toBe('/api/vault/pages');
    await expect(createRequest.json()).resolves.toEqual({
      content: '',
      force: false,
      is_database: false,
      metadata: {},
      title: 'New page',
    });

    const saveRequest = requestAt(fetchMock.mock.calls, 1);
    expect(saveRequest.method).toBe('PUT');
    expect(new URL(saveRequest.url).pathname).toBe('/api/vault/pages/page-1');
    await expect(saveRequest.json()).resolves.toEqual({
      content: '# Saved',
      force: true,
      is_database: false,
      metadata: { type: 'note' },
      title: 'Saved page',
    });

    const patchRequest = requestAt(fetchMock.mock.calls, 2);
    expect(patchRequest.method).toBe('PATCH');
    expect(new URL(patchRequest.url).pathname).toBe('/api/vault/pages/page-1');
    await expect(patchRequest.json()).resolves.toEqual({
      force: false,
      metadata: { archived: true },
    });

    const deleteRequest = requestAt(fetchMock.mock.calls, 3);
    expect(deleteRequest.method).toBe('DELETE');
    expect(new URL(deleteRequest.url).pathname).toBe('/api/vault/pages/page-1');
  });
});
