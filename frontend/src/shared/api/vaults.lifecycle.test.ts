import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAt, resetApiTestStorage } from '../../test/api-request';
import {
  emptyVaultTrash,
  fetchVaultAliasIndex,
  fetchVaultGlobalIndex,
  fetchVaultTrash,
  openVaultLocalPath,
  openVaultResource,
  purgeVaultTrashPage,
  resolveVaultTitle,
  restoreVaultPage,
} from './vaults';

afterEach(() => { resetApiTestStorage(); vi.unstubAllGlobals(); });

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
