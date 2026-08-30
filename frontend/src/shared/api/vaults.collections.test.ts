import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAt, resetApiTestStorage } from '../../test/api-request';
import {
  bulkApplyVaultTemplate,
  createVaultDatabase,
  createVaultTable,
  deleteVaultDatabase,
  deleteVaultTable,
  duplicateVaultPage,
  fetchVaultDatabases,
  fetchVaultRegistry,
  fetchVaultTables,
  patchVaultTableProperty,
  renameVaultTable,
} from './vaults';

afterEach(() => { resetApiTestStorage(); vi.unstubAllGlobals(); });

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
