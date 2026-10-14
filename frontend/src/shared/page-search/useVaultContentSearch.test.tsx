import { dispatchWindowEvent } from '../platform/browser-events';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installBrowserLocks } from '../../../tests/browser-locks';
import { resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';

import { searchVaultContent, type VaultSearchResponse } from '../api/vault-search';
import { USER_ID_STORAGE_KEY, WORKSPACE_ID_STORAGE_KEY } from '../api/request-context';
import { bulkApplyVaultTemplate, createVaultPage, restoreVaultPage } from '../api/vault-page-mutations';
import { acknowledgePageCreation, fetchPageCreationStatus } from '../api/page-creation-recovery';
import { queryClient } from '../api/query-client';
import { emitAppEvent } from '../platform/app-events';
import { writeStorage } from '../platform/browser-storage';
import { useVaultContentSearch } from './useVaultContentSearch';

vi.mock('../api/vault-search', () => ({ searchVaultContent: vi.fn() }));
const scope = vi.hoisted(() => ({ id: 'vault-a' }));
vi.mock('../hooks/useActiveVaultId', () => ({ useActiveVaultId: () => scope.id }));

let host: HTMLDivElement;
let root: Root;

function Probe({ query }: { readonly query: string }) {
  const search = useVaultContentSearch(query);
  return <div><output>{search.results.map((hit) => hit.title).join(',')}</output><button onClick={search.loadMore}>More</button><span>{search.loading ? 'loading' : search.error ?? 'ready'}</span></div>;
}

function response(id: string, total = 1): VaultSearchResponse {
  return { results: [{ id, title: id, path: `${id}.md`, excerpt: 'Body content', tags: [], line: 1 }], total, offset: 0, limit: 50 };
}

function render(query: string) { act(() => { root.render(<Probe query={query} />); }); }
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(200); }); }

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  vi.useFakeTimers();
  installBrowserLocks();
  writeApiTestStorage('gnosi_active_vault', 'vault-a');
  scope.id = 'vault-a';
  host = document.createElement('div');
  root = createRoot(host);
  vi.mocked(searchVaultContent).mockReset();
});
afterEach(() => {
  act(() => { root.unmount(); });
  resetApiTestStorage();
  queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});

it('debounces requests, aborts old work and ignores stale responses', async () => {
  let resolveOld: (value: VaultSearchResponse) => void = () => undefined;
  vi.mocked(searchVaultContent).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('new'));
  render('old');
  await settle();
  const signal = vi.mocked(searchVaultContent).mock.calls[0]?.[1]?.signal;
  render('new');
  expect(signal?.aborted).toBe(true);
  await settle();
  expect(host.querySelector('output')?.textContent).toBe('new');
  await act(async () => { resolveOld(response('old')); await Promise.resolve(); });
  expect(host.querySelector('output')?.textContent).toBe('new');
});

it('clears visible results immediately on Vault switch and requests the captured Vault', async () => {
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('private-a'));
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('private-b'));
  render('query');
  await settle();
  expect(host.textContent).toContain('private-a');
  scope.id = 'vault-b';
  render('query');
  expect(host.textContent).not.toContain('private-a');
  await settle();
  expect(vi.mocked(searchVaultContent).mock.calls[1]?.[1]?.vaultId).toBe('vault-b');
  expect(host.textContent).toContain('private-b');
});

it('appends subsequent pages and clears them when a new query is entered', async () => {
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('first', 2));
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('second', 2));
  render('query');
  await settle();
  act(() => { host.querySelector('button')?.click(); });
  await settle();
  expect(vi.mocked(searchVaultContent).mock.calls[1]?.[1]?.offset).toBe(1);
  expect(host.querySelector('output')?.textContent).toBe('first,second');
  render('changed');
  expect(host.querySelector('output')?.textContent).toBe('');
});

it.each([WORKSPACE_ID_STORAGE_KEY, USER_ID_STORAGE_KEY])('clears results when the account or workspace changes with the same Vault: %s', async (key) => {
  writeStorage(key, 'first-scope');
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('private-first'));
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('private-second'));
  render('query');
  await settle();
  expect(host.textContent).toContain('private-first');
  act(() => {
    writeStorage(key, 'second-scope');
    dispatchWindowEvent(new StorageEvent('storage', { key: key.name }));
  });
  expect(host.textContent).not.toContain('private-first');
  await settle();
  expect(host.textContent).toContain('private-second');
  expect(vi.mocked(searchVaultContent).mock.calls[1]?.[1]?.context).toMatchObject(
    key === WORKSPACE_ID_STORAGE_KEY ? { workspaceId: 'second-scope' } : { userId: 'second-scope' },
  );
});

it('discards an in-flight response after a context change even before React rerenders', async () => {
  writeStorage(WORKSPACE_ID_STORAGE_KEY, 'first');
  let resolveOld: (value: VaultSearchResponse) => void = () => undefined;
  vi.mocked(searchVaultContent).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  render('query');
  await settle();
  writeStorage(WORKSPACE_ID_STORAGE_KEY, 'second');
  await act(async () => { resolveOld(response('private-first')); await Promise.resolve(); });
  expect(host.textContent).not.toContain('private-first');
});

it('clears deleted hits, aborts old pagination and refetches the unchanged query from the beginning', async () => {
  let resolveOld: (value: VaultSearchResponse) => void = () => undefined;
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('deleted', 2));
  vi.mocked(searchVaultContent).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  vi.mocked(searchVaultContent).mockResolvedValueOnce({ results: [], total: 0, offset: 0, limit: 50 });
  render('unchanged query');
  await settle();
  act(() => { host.querySelector('button')?.click(); });
  await settle();
  const oldSignal = vi.mocked(searchVaultContent).mock.calls[1]?.[1]?.signal;
  act(() => {
    emitAppEvent('gnosi:page-deleted', { pageId: 'deleted' });
    expect(oldSignal?.aborted).toBe(true);
  });
  expect(host.querySelector('output')?.textContent).toBe('');
  await act(async () => { resolveOld(response('stale-deleted')); await Promise.resolve(); });
  await settle();
  expect(searchVaultContent).toHaveBeenCalledTimes(3);
  expect(vi.mocked(searchVaultContent).mock.calls[2]).toMatchObject([
    'unchanged query', { offset: 0, vaultId: 'vault-a' },
  ]);
  expect(host.querySelector('output')?.textContent).toBe('');
});

it('finds a restored match through the actual successful restore adapter without changing the query', async () => {
  vi.mocked(searchVaultContent).mockResolvedValueOnce({ results: [], total: 0, offset: 0, limit: 50 });
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('restored'));
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: 'restored', status: 'restored' })));
  render('unchanged query');
  await settle();
  await act(async () => { await restoreVaultPage('restored'); });
  await settle();
  expect(searchVaultContent).toHaveBeenCalledTimes(2);
  expect(host.querySelector('output')?.textContent).toBe('restored');
});

it('refreshes a mounted query after the actual successful create adapter commits', async () => {
  vi.mocked(searchVaultContent).mockResolvedValueOnce({ results: [], total: 0, offset: 0, limit: 50 });
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('created'));
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: 'created', status: 'created' })));
  render('unchanged query');
  await settle();
  await act(async () => { await createVaultPage({ title: 'Created note', content: 'Matching content' }); });
  await settle();
  expect(searchVaultContent).toHaveBeenCalledTimes(2);
  expect(host.querySelector('output')?.textContent).toBe('created');
});

it('keeps results and pagination when the actual create adapter fails after reserving an identity', async () => {
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('first', 2));
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('second', 2));
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ detail: 'Synthetic creation failure' }, { status: 503 })));
  render('unchanged query');
  await settle();
  act(() => { host.querySelector('button')?.click(); });
  await settle();
  await act(async () => {
    await expect(createVaultPage({ title: 'Failed note', content: 'Content' })).rejects.toMatchObject({ status: 503 });
  });
  await settle();
  expect(searchVaultContent).toHaveBeenCalledTimes(2);
  expect(host.querySelector('output')?.textContent).toBe('first,second');
});

it('refreshes a confirmed creation even when local acknowledgement fails after POST succeeds', async () => {
  vi.mocked(searchVaultContent).mockResolvedValueOnce({ results: [], total: 0, offset: 0, limit: 50 });
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('created'));
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(() => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Synthetic acknowledgement quota'); });
    return Promise.resolve(Response.json({ id: 'created', status: 'created' }));
  }));
  render('unchanged query');
  await settle();
  await act(async () => {
    await expect(createVaultPage({ title: 'Created note', content: 'Matching content' })).rejects.toThrow();
  });
  await settle();
  expect(searchVaultContent).toHaveBeenCalledTimes(2);
  expect(host.querySelector('output')?.textContent).toBe('created');
});

it('refreshes a completed recovery status before its local identity is acknowledged', async () => {
  vi.mocked(searchVaultContent).mockResolvedValueOnce({ results: [], total: 0, offset: 0, limit: 50 });
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('recovered'));
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
    status: 'completed', page_id: 'recovered', result: { id: 'recovered', status: 'created' },
    page_available: true, can_resume: false, steps: [],
  })));
  render('unchanged query');
  await settle();
  await act(async () => { await fetchPageCreationStatus('recovered-key'); });
  await settle();
  expect(searchVaultContent).toHaveBeenCalledTimes(2);
  expect(host.querySelector('output')?.textContent).toBe('recovered');
  await act(async () => { await acknowledgePageCreation('recovered-key'); });
  await settle();
  expect(searchVaultContent).toHaveBeenCalledTimes(2);
});

it.each(['pending', 'unknown'])('keeps search results when recovery status is %s', async status => {
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('existing'));
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
    status, page_id: 'uncertain', result: null, page_available: false, can_resume: false, steps: [],
  })));
  render('unchanged query');
  await settle();
  await act(async () => { await fetchPageCreationStatus('uncertain-key'); });
  await settle();
  expect(searchVaultContent).toHaveBeenCalledTimes(1);
  expect(host.querySelector('output')?.textContent).toBe('existing');
});

it.each(['errors', 'conflicts', 'skipped'])('keeps loaded search pages when a bulk template has only %s', async failure => {
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('first', 2));
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('second', 2));
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
    updated: 0, updated_ids: [], updated_with_etags: [], skipped: [], conflicts: [], errors: [],
    [failure]: [{ page_id: 'missing', error: 'Synthetic unsuccessful write' }],
  })));
  render('unchanged query');
  await settle();
  act(() => { host.querySelector('button')?.click(); });
  await settle();
  await act(async () => { await bulkApplyVaultTemplate({ page_ids: ['missing'], template_id: 'valid-template', expected_etags: {} }); });
  await settle();
  expect(searchVaultContent).toHaveBeenCalledTimes(2);
  expect(host.querySelector('output')?.textContent).toBe('first,second');
});

it('resets pagination after an actual partly successful bulk template mutation', async () => {
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('first', 2));
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('second', 2));
  vi.mocked(searchVaultContent).mockResolvedValueOnce(response('updated'));
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
    updated: 1, updated_ids: ['first'], updated_with_etags: [], skipped: [], conflicts: [],
    errors: [{ page_id: 'missing', error: 'not_found' }],
  })));
  render('unchanged query');
  await settle();
  act(() => { host.querySelector('button')?.click(); });
  await settle();
  await act(async () => { await bulkApplyVaultTemplate({ page_ids: ['first', 'missing'], template_id: 'valid-template', expected_etags: {} }); });
  await settle();
  expect(searchVaultContent).toHaveBeenCalledTimes(3);
  expect(vi.mocked(searchVaultContent).mock.calls[2]?.[1]?.offset).toBe(0);
  expect(host.querySelector('output')?.textContent).toBe('updated');
});
