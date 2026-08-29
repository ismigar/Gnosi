import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bulkApplyVaultTemplate,
  createVaultDatabase,
  createVaultPage,
  createVaultTable,
  deleteVaultDatabase,
  deleteVaultPage,
  deleteVaultTable,
  duplicateVaultPage,
  emptyVaultTrash,
  fetchVaultAliasIndex,
  fetchVaultDatabases,
  fetchVaultGlobalIndex,
  fetchVaultPage,
  fetchVaultPagePreview,
  fetchVaultPages,
  fetchVaultPagesByTable,
  fetchVaultRegistry,
  fetchVaultTablePagesSnapshot,
  fetchVaultTables,
  fetchVaultTrash,
  openVaultLocalPath,
  openVaultResource,
  patchVaultTableProperty,
  patchVaultPage,
  purgeVaultTrashPage,
  renameVaultTable,
  resolveVaultTitle,
  restoreVaultPage,
  saveVaultPage,
  warmVaultPagePreviews,
} from './vaults';


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


function requestAt(
  calls: [RequestInfo | URL, RequestInit?][],
  index: number,
): Request {
  const call = calls[index];
  if (!call) throw new Error(`Expected fetch call ${String(index)}`);
  const [input, init] = call;
  return input instanceof Request
    ? input
    : new Request(new URL(String(input), window.location.origin), init);
}


describe('vault collections API', () => {
  it('patches one immutable table property through both path identifiers', async () => {
    const response = {
      status: 'success',
      table_id: 'table-1',
      property: {
        id: 'status',
        name: 'Status',
        type: 'select',
        config: { options: [{ name: 'Open' }] },
      },
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      patchVaultTableProperty('table-1', 'status', {
        config: { options: [{ name: 'Open' }] },
      }),
    ).resolves.toEqual(response);

    const request = requestAt(fetchMock.mock.calls, 0);
    expect(request.method).toBe('PATCH');
    expect(new URL(request.url).pathname).toBe(
      '/api/vault/tables/table-1/properties/status',
    );
  });

  it('duplicates one page and applies a template to a selected batch', async () => {
    const duplicate = {
      status: 'created',
      id: 'page-copy',
      message: 'Page duplicated',
      title: 'Copy',
    };
    const batch = {
      updated: 1,
      updated_ids: ['page-1'],
      updated_with_etags: [{ page_id: 'page-1', etag: 'etag-2' }],
      skipped: [],
      conflicts: [],
      errors: [],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(duplicate))
      .mockResolvedValueOnce(Response.json(batch));
    vi.stubGlobal('fetch', fetchMock);

    await expect(duplicateVaultPage('page-1')).resolves.toEqual(duplicate);
    await expect(
      bulkApplyVaultTemplate({ page_ids: ['page-1'], template_id: 'template-1' }),
    ).resolves.toEqual(batch);

    expect(new URL(requestAt(fetchMock.mock.calls, 0).url).pathname).toBe(
      '/api/vault/pages/page-1/duplicate',
    );
    const batchRequest = requestAt(fetchMock.mock.calls, 1);
    expect(new URL(batchRequest.url).pathname).toBe('/api/vault/bulk-apply-template');
    await expect(batchRequest.clone().json()).resolves.toEqual({
      page_ids: ['page-1'],
      template_id: 'template-1',
    });
  });

  it('loads the full typed registry without dropping extension state', async () => {
    const registry = {
      databases: [{ id: 'db-1', name: 'Knowledge' }],
      tables: [{ id: 'table-1', name: 'Notes' }],
      views: [{ id: 'view-1', table_id: 'table-1' }],
      plugin_state: { enabled: true },
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(registry));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVaultRegistry()).resolves.toEqual(registry);

    const request = requestAt(fetchMock.mock.calls, 0);
    expect(request.method).toBe('GET');
    expect(new URL(request.url).pathname).toBe('/api/vault/registry');
  });

  it('lists, creates and deletes databases with exact paths and bodies', async () => {
    const databases = [{ id: 'brain', name: 'Brain' }];
    const created = { id: 'research', name: 'Research' };
    const deleted = { id: 'research', name: 'Research' };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(databases))
      .mockResolvedValueOnce(Response.json(created))
      .mockResolvedValueOnce(Response.json(deleted));
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    await expect(fetchVaultDatabases(controller.signal)).resolves.toEqual(databases);
    await expect(createVaultDatabase({ name: 'Research' })).resolves.toEqual(created);
    await expect(deleteVaultDatabase('research')).resolves.toEqual(deleted);

    const listRequest = requestAt(fetchMock.mock.calls, 0);
    expect(new URL(listRequest.url).pathname).toBe('/api/vault/databases');
    controller.abort();
    expect(listRequest.signal.aborted).toBe(true);

    const createRequest = requestAt(fetchMock.mock.calls, 1);
    expect(createRequest.method).toBe('POST');
    expect(new URL(createRequest.url).pathname).toBe('/api/vault/databases');
    await expect(createRequest.json()).resolves.toEqual({ name: 'Research' });

    const deleteRequest = requestAt(fetchMock.mock.calls, 2);
    expect(deleteRequest.method).toBe('DELETE');
    expect(new URL(deleteRequest.url).pathname).toBe(
      '/api/vault/databases/research',
    );
  });


  it('uses generated table filters, revision queries and mutation bodies', async () => {
    const tables = [{ id: 'notes', name: 'Notes' }];
    const created = { id: 'sources', name: 'Sources' };
    const renamed = { id: 'sources', name: 'References' };
    const deleted = { id: 'sources', name: 'References' };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(tables))
      .mockResolvedValueOnce(Response.json(created))
      .mockResolvedValueOnce(Response.json(renamed))
      .mockResolvedValueOnce(Response.json(deleted));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVaultTables('brain')).resolves.toEqual(tables);
    await expect(
      createVaultTable({ database_id: 'brain', name: 'Sources' }),
    ).resolves.toEqual(created);
    await expect(
      renameVaultTable('sources', { name: 'References' }),
    ).resolves.toEqual(renamed);
    await expect(
      deleteVaultTable('sources', {
        expected_asset_revision: 'asset-3',
        expected_table_revision: 'table-2',
        expected_views_revision: 'views-1',
      }),
    ).resolves.toEqual(deleted);

    const listUrl = new URL(requestAt(fetchMock.mock.calls, 0).url);
    expect(listUrl.pathname).toBe('/api/vault/tables');
    expect(listUrl.searchParams.get('database_id')).toBe('brain');

    const createRequest = requestAt(fetchMock.mock.calls, 1);
    expect(createRequest.method).toBe('POST');
    await expect(createRequest.json()).resolves.toEqual({
      database_id: 'brain',
      name: 'Sources',
    });

    const renameRequest = requestAt(fetchMock.mock.calls, 2);
    expect(renameRequest.method).toBe('PUT');
    expect(new URL(renameRequest.url).pathname).toBe('/api/vault/tables/sources');
    await expect(renameRequest.json()).resolves.toEqual({ name: 'References' });

    const deleteRequest = requestAt(fetchMock.mock.calls, 3);
    const deleteUrl = new URL(deleteRequest.url);
    expect(deleteRequest.method).toBe('DELETE');
    expect(deleteUrl.pathname).toBe('/api/vault/tables/sources');
    expect(Object.fromEntries(deleteUrl.searchParams)).toEqual({
      expected_asset_revision: 'asset-3',
      expected_table_revision: 'table-2',
      expected_views_revision: 'views-1',
    });
  });
});


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


describe('vault title resolution and trash API', () => {
  it('resolves titles and performs recoverable trash operations', async () => {
    const resolved = { id: 'page-1', title: 'Page one' };
    const trash = {
      items: [{ id: 'page-1', size_bytes: 42, title: 'Page one' }],
      retention_days: 90,
    };
    const restored = { id: 'page-1', status: 'restored' };
    const purged = { freed_bytes: 42, id: 'page-1', status: 'purged' };
    const emptied = {
      failed_count: 0,
      failed_ids: [],
      freed_bytes: 42,
      purged_count: 1,
      status: 'emptied',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(resolved))
      .mockResolvedValueOnce(Response.json(trash))
      .mockResolvedValueOnce(Response.json(restored))
      .mockResolvedValueOnce(Response.json(purged))
      .mockResolvedValueOnce(Response.json(emptied));
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveVaultTitle('Page one')).resolves.toEqual(resolved);
    await expect(fetchVaultTrash({ q: 'Page' })).resolves.toEqual(trash);
    await expect(restoreVaultPage('page-1')).resolves.toEqual(restored);
    await expect(purgeVaultTrashPage('page-1')).resolves.toEqual(purged);
    await expect(emptyVaultTrash()).resolves.toEqual(emptied);

    const resolveUrl = new URL(requestAt(fetchMock.mock.calls, 0).url);
    expect(resolveUrl.pathname).toBe('/api/vault/resolve-by-title');
    expect(resolveUrl.searchParams.get('title')).toBe('Page one');

    const trashUrl = new URL(requestAt(fetchMock.mock.calls, 1).url);
    expect(trashUrl.pathname).toBe('/api/vault/trash');
    expect(trashUrl.searchParams.get('q')).toBe('Page');

    expect(requestAt(fetchMock.mock.calls, 2).method).toBe('POST');
    expect(new URL(requestAt(fetchMock.mock.calls, 3).url).pathname).toBe(
      '/api/vault/trash/page-1',
    );
    expect(requestAt(fetchMock.mock.calls, 4).method).toBe('DELETE');
  });
});


describe('vault host-open API', () => {
  it('opens local paths and resources through typed JSON operations', async () => {
    const localResult = {
      kind: 'file',
      status: 'ok',
      target: '/Users/test/document.pdf',
    };
    const resourceResult = {
      opened_with: 'zotero_uri',
      status: 'ok',
      target: 'zotero://select/items/1_ABC',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(localResult))
      .mockResolvedValueOnce(Response.json(resourceResult));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      openVaultLocalPath({ url: 'file:///Users/test/document.pdf' }),
    ).resolves.toEqual(localResult);
    await expect(
      openVaultResource({ zotero_uri: 'zotero://select/items/1_ABC' }),
    ).resolves.toEqual(resourceResult);

    const localRequest = requestAt(fetchMock.mock.calls, 0);
    expect(localRequest.method).toBe('POST');
    expect(new URL(localRequest.url).pathname).toBe('/api/vault/open-local-path');
    await expect(localRequest.json()).resolves.toEqual({
      url: 'file:///Users/test/document.pdf',
    });

    const resourceRequest = requestAt(fetchMock.mock.calls, 1);
    expect(resourceRequest.method).toBe('POST');
    expect(new URL(resourceRequest.url).pathname).toBe('/api/vault/open-resource');
    await expect(resourceRequest.json()).resolves.toEqual({
      zotero_uri: 'zotero://select/items/1_ABC',
    });
  });
});


describe('vault index API', () => {

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
