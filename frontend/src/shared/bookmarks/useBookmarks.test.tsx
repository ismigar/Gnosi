import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestAt, resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { queryClient } from '../api/query-client';
import { currentRequestContext } from '../api/request-context';
import { emitAppEvent } from '../platform/app-events';
import { cachedBookmarkCollection } from './bookmark-migration';
import { bookmarkScope, loadBookmarks, saveBookmarks } from './bookmarks';
import { bookmarkQueryKey, useBookmarks } from './useBookmarks';

type State = ReturnType<typeof useBookmarks>;
const entry = { id: 'old', label: 'Custom alias', group: 'Research', kind: 'page' as const, target: 'note' };
const migrated = { ...entry, id: 'migrated', created_at: 10 };
const collection = { entries: [migrated], sort_mode: 'manual' };
let current: State;
let root: ReturnType<typeof createRoot>;
let container: HTMLElement;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
}
async function mount() {
  function Harness() {
    const state = useBookmarks();
    useLayoutEffect(() => { current = state; });
    return null;
  }
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Harness />); await Promise.resolve(); });
  await settle();
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  queryClient.clear(); resetApiTestStorage();
  writeApiTestStorage('gnosi_active_vault', 'vault');
  writeApiTestStorage('gnosi_workspace_id', 'workspace');
  writeApiTestStorage('gnosi_user_id', 'user');
  queryClient.setQueryDefaults(['vault-bookmarks'], { retry: false });
  fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(Response.json(collection)));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  await act(async () => { root.unmount(); await Promise.resolve(); });
  container.remove();
  await queryClient.cancelQueries(); queryClient.clear();
  resetApiTestStorage(); vi.unstubAllGlobals();
});

describe('synchronized bookmarks', () => {
  it('imports the device legacy list and favorite order once and retains the original source', async () => {
    const scope = bookmarkScope();
    saveBookmarks(scope, [entry]);
    writeApiTestStorage('gnosi.sidebar.favoritesSort', JSON.stringify({ mode: 'alpha-asc', manualOrder: ['note'] }));
    await mount();
    expect(current.isReady).toBe(true);
    expect(current.entries).toEqual([migrated]);
    expect(current.pageIds.has('note')).toBe(true);
    expect(await requestAt(fetchMock.mock.calls, 1).json()).toEqual({ entries: [entry], sort_mode: 'alpha-asc', page_order: ['note'] });
    expect(loadBookmarks(scope)).toEqual([entry]);
    fetchMock.mockClear();
    fetchMock.mockImplementation(() => Promise.resolve(Response.json({ entries: [], sort_mode: 'manual' })));
    await act(async () => { await current.refresh(); }); await settle();
    expect(current.entries).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestAt(fetchMock.mock.calls, 0).method).toBe('GET');
    expect(loadBookmarks(scope)).toEqual([entry]);
  });
  it('retries an interrupted migration without acknowledging or deleting local elements', async () => {
    saveBookmarks(bookmarkScope(), [entry]);
    fetchMock.mockImplementation(request => Promise.resolve(new Request(request).method === 'POST'
      ? Response.json({ detail: 'Unavailable' }, { status: 503 }) : Response.json(collection)));
    await mount();
    expect(current.error).toBe(true); expect(current.isReady).toBe(false);
    expect(loadBookmarks(bookmarkScope())).toEqual([entry]);
    fetchMock.mockImplementation(() => Promise.resolve(Response.json(collection)));
    await act(async () => { await current.refresh(); }); await settle();
    expect(current.isReady).toBe(true); expect(current.entries).toEqual([migrated]);
    expect(fetchMock.mock.calls.filter((_, i) => requestAt(fetchMock.mock.calls, i).method === 'POST')).toHaveLength(2);
  });
  it('updates the shared cache and page-star membership without changing page metadata', async () => {
    await mount();
    fetchMock.mockResolvedValueOnce(Response.json({ entries: [], sort_mode: 'manual' }));
    await act(async () => { await current.setPage('note', 'Original title', false); }); await settle();
    expect(current.entries).toEqual([]); expect(current.pageIds.has('note')).toBe(false);
    expect(cachedBookmarkCollection(currentRequestContext())?.entries).toEqual([]);
    expect(requestAt(fetchMock.mock.calls, 2).url).toContain('/bookmarks/pages/note');
    expect(queryClient.getQueryData(bookmarkQueryKey(currentRequestContext()))).toEqual({ entries: [], sort_mode: 'manual' });
  });
  it('keeps existing entries on failed edits and permits retry after a successful refresh', async () => {
    await mount();
    fetchMock.mockResolvedValueOnce(Response.json({ detail: 'Write failed' }, { status: 503 }));
    await act(async () => { await expect(current.remove(migrated.id)).rejects.toMatchObject({ status: 503 }); }); await settle();
    expect(current.entries).toEqual([migrated]); expect(current.error).toBe(true);
    await act(async () => { await current.refresh(); }); await settle();
    expect(current.error).toBe(false);
  });
  it('isolates the current vault while a former-vault write finishes', async () => {
    await mount();
    let finish: ((value: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let saving: Promise<unknown> | undefined;
    await act(async () => { saving = current.save({ ...entry, label: 'Changed in A' }); await Promise.resolve(); });
    await settle();
    writeApiTestStorage('gnosi_active_vault', 'other');
    fetchMock.mockImplementation(() => Promise.resolve(Response.json({ entries: [], sort_mode: 'manual' })));
    await act(async () => { emitAppEvent('gnosi:vault-changed', { id: 'other', name: 'Other', slug: 'other' }); await Promise.resolve(); }); await settle();
    await act(async () => { finish?.(Response.json(collection)); await saving; }); await settle();
    expect(current.entries).toEqual([]);
    expect(cachedBookmarkCollection(currentRequestContext())?.entries).toEqual([]);
    expect(cachedBookmarkCollection({ ...currentRequestContext(), vaultId: 'vault' })?.entries).toEqual([migrated]);
  });
});
