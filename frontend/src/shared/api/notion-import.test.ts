import { resetApiTestStorage } from '../../test/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NOTION_LIST_TIMEOUT_MS,
  NOTION_PROGRESS_TIMEOUT_MS,
  abortNotionClone,
  connectNotionToken,
  disconnectNotionToken,
  fetchNotionCloneProgress,
  fetchNotionDatabaseSchema,
  fetchNotionDatabases,
  fetchNotionImportConfig,
  fetchNotionLinkedDatabases,
  fetchNotionLoosePages,
  fetchNotionOAuthStatus,
  fetchNotionStatus,
  fetchNotionVaultRegistry,
  saveNotionImportConfig,
  startNotionClone,
  verifyNotionClone,
  type NotionCloneResult,
  type NotionVerification,
} from './notion-import';


afterEach(() => {
  resetApiTestStorage();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});


interface RecordedFetchMock {
  readonly mock: {
    readonly calls: ReadonlyArray<readonly [RequestInfo | URL, RequestInit?]>;
  };
}


function requestAt(fetchMock: RecordedFetchMock, index = 0): Request {
  const input = fetchMock.mock.calls[index]?.[0];
  if (!(input instanceof Request)) throw new Error('Expected a Request instance');
  return input;
}


describe('Notion import API', () => {
  it('persists config and covers schema, status and token operations', async () => {
    const config = {
      databases: [{ id: 'db-1', title: 'Research' }],
      selected: ['db-1'],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ config }))
      .mockResolvedValueOnce(Response.json({ status: 'success' }))
      .mockResolvedValueOnce(Response.json({
        name: 'Research',
        schema: { Title: 'title' },
      }))
      .mockResolvedValueOnce(Response.json({ connected: true }))
      .mockResolvedValueOnce(Response.json({ connected: false }))
      .mockResolvedValueOnce(Response.json({ status: 'success', name: 'Ismael' }))
      .mockResolvedValueOnce(Response.json({ status: 'success' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchNotionImportConfig()).resolves.toEqual({ config });
    await expect(saveNotionImportConfig(config)).resolves.toEqual({
      status: 'success',
    });
    await expect(fetchNotionDatabaseSchema('db/one')).resolves.toEqual({
      name: 'Research',
      schema: { Title: 'title' },
    });
    await expect(fetchNotionStatus()).resolves.toEqual({ connected: true });
    await expect(fetchNotionOAuthStatus()).resolves.toEqual({ connected: false });
    await expect(connectNotionToken('ntn_secret')).resolves.toEqual({
      name: 'Ismael',
      status: 'success',
    });
    await expect(disconnectNotionToken()).resolves.toEqual({ status: 'success' });

    expect(
      fetchMock.mock.calls.map((_, index) => {
        const request = requestAt(fetchMock, index);
        return [request.method, new URL(request.url).pathname];
      }),
    ).toEqual([
      ['GET', '/api/notion/import-config'],
      ['PUT', '/api/notion/import-config'],
      ['GET', '/api/notion/databases/db%2Fone/schema'],
      ['GET', '/api/notion/status'],
      ['GET', '/api/notion-oauth/status'],
      ['POST', '/api/notion/token'],
      ['DELETE', '/api/notion/token'],
    ]);
    await expect(requestAt(fetchMock, 1).clone().json()).resolves.toEqual(config);
    await expect(requestAt(fetchMock, 5).clone().json()).resolves.toEqual({
      token: 'ntn_secret',
    });
  });


  it('loads linked databases, database catalog and loose pages', async () => {
    const linked = {
      linked: [{ kind: 'linked', page_title: 'Home', title: 'Tasks' }],
      scanned: 3,
      capped: false,
    };
    const databases = { databases: [{ id: 'db-1', title: 'Research' }] };
    const pages = { pages: [{ id: 'page-1', title: 'Loose page' }] };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(linked))
      .mockResolvedValueOnce(Response.json(databases))
      .mockResolvedValueOnce(Response.json(pages));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchNotionLinkedDatabases()).resolves.toEqual(linked);
    await expect(fetchNotionDatabases()).resolves.toEqual(databases);
    await expect(fetchNotionLoosePages()).resolves.toEqual(pages);

    expect(
      fetchMock.mock.calls.map((_, index) =>
        new URL(requestAt(fetchMock, index).url).pathname),
    ).toEqual([
      '/api/notion/linked-databases',
      '/api/notion/databases',
      '/api/notion/loose-pages',
    ]);
  });


  it('keeps destination Vault headers and clone bodies unchanged', async () => {
    const clone: NotionCloneResult = {
      attachments: 4,
      errors: [],
      pages: 8,
      status: 'success',
      tables: 2,
      truncated: false,
      views: 3,
      warnings: [],
    };
    const verification: NotionVerification = {
      empty_bodies: [],
      missing_assets: [],
      orphan_relations: [],
      status: 'success',
      summary: {
        empty_bodies: 0,
        healthy: true,
        missing_assets: 0,
        orphan_relations: 0,
        pages: 8,
        tables_ok: 2,
        tables_total: 2,
        views: 3,
      },
      tables: [],
    };
    const cloneInput = {
      database_ids: ['db-1', 'db-2'],
      loose_page_types: { 'page-1': 'wiki' },
      schema_overrides: { 'db-1': { Status: 'select' } },
      target_folder: '',
    };
    const verifyInput = {
      database_ids: ['db-1', 'db-2'],
      target_folder: '',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ tables: [{ id: 'notion-db' }] }))
      .mockResolvedValueOnce(Response.json(clone))
      .mockResolvedValueOnce(Response.json({ status: 'aborting' }))
      .mockResolvedValueOnce(Response.json(verification));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchNotionVaultRegistry('vault-destination')).resolves.toEqual({
      tables: [{ id: 'notion-db' }],
    });
    await expect(
      startNotionClone(cloneInput, 'vault-destination'),
    ).resolves.toEqual(clone);
    await expect(abortNotionClone()).resolves.toEqual({ status: 'aborting' });
    await expect(
      verifyNotionClone(verifyInput, 'vault-destination'),
    ).resolves.toEqual(verification);

    for (const index of [0, 1, 3]) {
      expect(requestAt(fetchMock, index).headers.get('X-Vault-ID')).toBe(
        'vault-destination',
      );
    }
    await expect(requestAt(fetchMock, 1).clone().json()).resolves.toEqual(cloneInput);
    await expect(requestAt(fetchMock, 3).clone().json()).resolves.toEqual(verifyInput);
    expect(await requestAt(fetchMock, 1).clone().json()).not.toHaveProperty(
      'download_assets',
    );
    expect(await requestAt(fetchMock, 1).clone().json()).not.toHaveProperty(
      'follow_subpages',
    );
    expect(await requestAt(fetchMock, 1).clone().json()).not.toHaveProperty(
      'prune_orphans',
    );
  });


  it('preserves the 120-second list and 8-second progress timeouts', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const request = input instanceof Request ? input : new Request(input);
      return new Promise<Response>((_resolve, reject) => {
        const rejectOnAbort = () => {
          reject(new Error('Request aborted'));
        };
        if (request.signal.aborted) rejectOnAbort();
        else request.signal.addEventListener('abort', rejectOnAbort, { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const listPending = fetchNotionDatabases();
    const listRejection = expect(listPending).rejects.toThrow(
      `timeout of ${String(NOTION_LIST_TIMEOUT_MS)}ms exceeded`,
    );
    await vi.advanceTimersByTimeAsync(NOTION_LIST_TIMEOUT_MS);
    await listRejection;

    const progressPending = fetchNotionCloneProgress();
    const progressRejection = expect(progressPending).rejects.toThrow(
      `timeout of ${String(NOTION_PROGRESS_TIMEOUT_MS)}ms exceeded`,
    );
    await vi.advanceTimersByTimeAsync(NOTION_PROGRESS_TIMEOUT_MS);
    await progressRejection;
  });


  it('normalizes FastAPI detail errors at the shared boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { detail: 'Token invàlid o sense permisos' },
          { status: 400, statusText: 'Bad Request' },
        ),
      ),
    );

    await expect(connectNotionToken('bad')).rejects.toMatchObject({
      message: 'Token invàlid o sense permisos',
      name: 'GnosiApiError',
      status: 400,
    });
  });
});
