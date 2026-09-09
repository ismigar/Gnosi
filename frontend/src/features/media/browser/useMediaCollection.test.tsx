import {act, useLayoutEffect} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {fetchMediaPage, fetchMediaRoots, fetchMediaTree, type MediaPage, type MediaPageQuery} from '../../../shared/api/media-browser';
import {useMediaCollection, type MediaCollection} from './useMediaCollection';
import {mediaAsset, MEDIA_ROOTS} from './fixtures';
import {DEFAULT_FILTERS} from './model';

const scope = vi.hoisted(() => ({vaultId: 'vault-a'}));
vi.mock('../../../shared/api/vault-context', () => ({getActiveVaultId: () => scope.vaultId}));
vi.mock('../../../shared/api/media-browser', () => ({fetchMediaPage: vi.fn(), fetchMediaRoots: vi.fn(), fetchMediaTree: vi.fn()}));
vi.mock('../../../shared/notifications/toast', () => ({default: {error: vi.fn()}}));
vi.mock('react-i18next', () => {
    const t = (key: string) => key;
    return {useTranslation: () => ({t})};
});
let root: Root;
let host: HTMLDivElement;
let current: MediaCollection;
function Harness() {
    const value = useMediaCollection();
    useLayoutEffect(() => {current = value;});
    return <output>{value.media.map(item => item.id).join(',')}</output>;
}
function page(ids: string[], revision = 'old', state: MediaPage['indexState'] = 'refreshing', total = ids.length): MediaPage {
    return {items: ids.map(id => mediaAsset(id)), total, limit: 50, offset: 0, root: 'images', indexState: state, indexRevision: revision};
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(finish => {resolve = finish;});
    return {promise, resolve};
}
async function update(action: () => void | Promise<void>) {
    await act(async () => {await action();});
}
async function mount() {await update(() => {root.render(<Harness/>);});}
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers(); scope.vaultId = 'vault-a';
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    vi.mocked(fetchMediaRoots).mockResolvedValue(MEDIA_ROOTS);
    vi.mocked(fetchMediaTree).mockResolvedValue([]);
    vi.mocked(fetchMediaPage).mockResolvedValue(page(['old']));
});
afterEach(async () => {
    await update(() => {root.unmount();});
    host.remove(); vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals();
});

it('keeps an empty complete snapshot usable while polling and stops as soon as it is fresh', async () => {
    vi.mocked(fetchMediaPage).mockResolvedValueOnce(page([]));
    await mount();
    expect(current.hasSnapshot).toBe(true);
    expect(current.loading).toBe(false);
    expect(current.indexState).toBe('refreshing');
    const fresh = deferred<MediaPage>();
    vi.mocked(fetchMediaPage).mockReturnValueOnce(fresh.promise);
    await update(async () => {await vi.advanceTimersByTimeAsync(5000);});
    expect(current.loading).toBe(true);
    expect(current.hasSnapshot).toBe(true);
    expect(current.media).toEqual([]);
    await update(() => {fresh.resolve(page(['new'], 'new', 'fresh'));});
    expect(current.media[0]?.id).toBe('new');
    expect(current.indexState).toBe('fresh');
    await update(async () => {await vi.advanceTimersByTimeAsync(60_000);});
    expect(fetchMediaPage).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
});

it('retains failed snapshots, waits out Retry-After and only retries on demand', async () => {
    vi.mocked(fetchMediaPage).mockResolvedValueOnce({...page(['old'], 'old', 'failed'), indexRetryAfter: 30});
    await mount();
    expect(current.indexError).toBe(true);
    expect(current.indexRetryBlocked).toBe(true);
    expect(current.media[0]?.id).toBe('old');
    await update(async () => {await vi.advanceTimersByTimeAsync(30_000);});
    expect(current.indexRetryBlocked).toBe(false);
    expect(fetchMediaPage).toHaveBeenCalledOnce();
    vi.mocked(fetchMediaPage).mockResolvedValueOnce(page(['new'], 'new', 'fresh'));
    await update(async () => {await current.fetchMedia(true);});
    expect(current.indexError).toBe(false);
    expect(current.media[0]?.id).toBe('new');
    expect(fetchMediaPage).toHaveBeenCalledTimes(2);
});

it('replaces the entire loaded prefix when a new revision shifts page boundaries', async () => {
    const oldIds = Array.from({length: 100}, (_, index) => 'old-' + String(index));
    vi.mocked(fetchMediaPage).mockResolvedValueOnce(page(oldIds.slice(0, 50), 'old', 'refreshing', 150));
    await mount();
    vi.mocked(fetchMediaPage).mockResolvedValueOnce(page(oldIds.slice(50), 'old', 'refreshing', 150));
    await update(async () => {await current.fetchMedia(false);});
    expect(current.media).toHaveLength(100);
    const newIds = ['inserted', ...oldIds];
    const second = deferred<MediaPage>();
    vi.mocked(fetchMediaPage).mockResolvedValueOnce(page(newIds.slice(0, 50), 'new', 'fresh', 151));
    vi.mocked(fetchMediaPage).mockReturnValueOnce(second.promise);
    await update(async () => {await vi.advanceTimersByTimeAsync(5000);});
    expect(current.media.map(item => item.id)).toEqual(oldIds);
    expect(fetchMediaPage).toHaveBeenLastCalledWith({root: 'images', offset: 50, limit: 50}, expect.any(AbortSignal), 600_000);
    await update(() => {second.resolve(page(newIds.slice(50, 100), 'new', 'fresh', 151));});
    expect(current.media.map(item => item.id)).toEqual(newIds.slice(0, 100));
    expect(new Set(current.media.map(item => item.id)).size).toBe(100);
    expect(current.hasMore).toBe(true);
});

it('advances past deleted slots in sparse and empty pages, including a refreshed prefix', async () => {
    vi.mocked(fetchMediaPage).mockResolvedValueOnce({...page(['first'], 'old', 'refreshing', 150), nextOffset: 50});
    await mount();
    expect(current.hasMore).toBe(true);
    vi.mocked(fetchMediaPage).mockResolvedValueOnce({...page([], 'old', 'refreshing', 150), nextOffset: 100});
    await update(async () => {await current.fetchMedia(false);});
    expect(fetchMediaPage).toHaveBeenLastCalledWith({root: 'images', offset: 50, limit: 50}, expect.any(AbortSignal), 600_000);
    expect(current.media.map(item => item.id)).toEqual(['first']);
    expect(current.hasMore).toBe(true);
    vi.mocked(fetchMediaPage).mockResolvedValueOnce({...page(['last'], 'old', 'refreshing', 150), nextOffset: 150});
    await update(async () => {await current.fetchMedia(false);});
    expect(fetchMediaPage).toHaveBeenLastCalledWith({root: 'images', offset: 100, limit: 50}, expect.any(AbortSignal), 600_000);
    expect(current.media.map(item => item.id)).toEqual(['first', 'last']);
    expect(current.hasMore).toBe(false);
    vi.mocked(fetchMediaPage).mockResolvedValueOnce({...page([], 'new', 'fresh', 150), nextOffset: 50});
    vi.mocked(fetchMediaPage).mockResolvedValueOnce({...page(['surviving'], 'new', 'fresh', 150), nextOffset: 150});
    await update(async () => {await vi.advanceTimersByTimeAsync(5000);});
    expect(fetchMediaPage).toHaveBeenLastCalledWith({root: 'images', offset: 50, limit: 100}, expect.any(AbortSignal), 600_000);
    expect(current.media.map(item => item.id)).toEqual(['surviving']);
    expect(current.hasMore).toBe(false);
});

it('does not publish mixed revisions if an index changes during the prefix read', async () => {
    const oldIds = Array.from({length: 100}, (_, index) => String(index));
    vi.mocked(fetchMediaPage).mockResolvedValueOnce(page(oldIds.slice(0, 50), 'old', 'refreshing', 150));
    await mount();
    vi.mocked(fetchMediaPage).mockResolvedValueOnce(page(oldIds.slice(50), 'old', 'refreshing', 150));
    await update(async () => {await current.fetchMedia(false);});
    vi.mocked(fetchMediaPage).mockResolvedValueOnce(page(oldIds.slice(0, 50), 'new', 'fresh', 150));
    vi.mocked(fetchMediaPage).mockResolvedValueOnce(page(oldIds.slice(50), 'newer', 'fresh', 150));
    await update(async () => {await vi.advanceTimersByTimeAsync(5000);});
    expect(current.media.map(item => item.id)).toEqual(oldIds);
    expect(current.indexError).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
});

it.each(['root', 'album', 'vault', 'filters'] as const)('cancels pending reads and ignores old results after a %s change', async change => {
    const old = deferred<MediaPage>();
    vi.mocked(fetchMediaPage).mockReturnValueOnce(old.promise);
    await mount();
    const oldSignal = vi.mocked(fetchMediaPage).mock.calls[0]?.[1];
    const next = deferred<MediaPage>();
    vi.mocked(fetchMediaPage).mockReturnValueOnce(next.promise);
    await update(() => {
        if (change === 'root') current.setActiveRoot('assets');
        if (change === 'album') current.setActiveAlbum('Another album');
        if (change === 'filters') current.setFilters({...DEFAULT_FILTERS, q: 'new'});
        if (change === 'vault') {scope.vaultId = 'vault-b'; root.render(<Harness/>);}
    });
    expect(oldSignal?.aborted).toBe(true);
    await update(() => {old.resolve(page(['old']));});
    expect(current.media).toEqual([]);
    expect(current.loading).toBe(true);
    await update(() => {next.resolve(page(['new'], 'new', 'fresh'));});
    expect(current.media[0]?.id).toBe('new');
    expect(host.textContent).not.toContain('old');
    const lastQuery = vi.mocked(fetchMediaPage).mock.calls.at(-1)?.[0];
    if (change === 'filters') expect(lastQuery?.q).toBe('new');
    if (change === 'album') expect(lastQuery?.album).toBe('Another album');
});

it('bounds polling and cancels request, discovery and timers on unmount', async () => {
    await mount();
    await update(async () => {await vi.advanceTimersByTimeAsync(300_000);});
    expect(current.indexPollingPaused).toBe(true);
    expect(fetchMediaPage).toHaveBeenCalledTimes(61);
    const count = vi.mocked(fetchMediaPage).mock.calls.length;
    await update(async () => {await vi.advanceTimersByTimeAsync(60_000);});
    expect(fetchMediaPage).toHaveBeenCalledTimes(count);
    await update(async () => {await current.fetchMedia(true);});
    expect(current.indexPollingPaused).toBe(false);
    const pageSignal = vi.mocked(fetchMediaPage).mock.calls.at(-1)?.[1];
    const rootsSignal = vi.mocked(fetchMediaRoots).mock.calls[0]?.[0];
    const treeSignal = vi.mocked(fetchMediaTree).mock.calls[0]?.[2];
    await update(() => {root.unmount();}); root = createRoot(host);
    expect(pageSignal?.aborted).toBe(true);
    expect(rootsSignal?.aborted).toBe(true);
    expect(treeSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
});

it('uses bounded page sizes when refreshing more than 500 loaded items', async () => {
    const oldIds = Array.from({length: 600}, (_, index) => String(index));
    let revision = 'old';
    vi.mocked(fetchMediaPage).mockImplementation((query: MediaPageQuery) => Promise.resolve({
        ...page(oldIds.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 50)), revision, 'refreshing', 700),
        offset: query.offset ?? 0, limit: query.limit ?? 50,
    }));
    await mount();
    for (let index = 0; index < 11; index++) await update(async () => {await current.fetchMedia(false);});
    expect(current.media).toHaveLength(600);
    revision = 'new';
    await update(async () => {await vi.advanceTimersByTimeAsync(5000);});
    expect(current.media).toHaveLength(600);
    const requests = vi.mocked(fetchMediaPage).mock.calls.slice(-3).map(call => call[0]);
    expect(requests.map(query => [query.offset, query.limit])).toEqual([[0, 50], [50, 500], [550, 50]]);
});
