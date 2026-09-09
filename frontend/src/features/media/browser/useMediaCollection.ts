import {useCallback, useEffect, useMemo, useRef, useState, type SetStateAction} from 'react';
import {useTranslation} from 'react-i18next';
import toast from '../../../shared/notifications/toast';
import {fetchMediaPage, fetchMediaRoots, fetchMediaTree, type MediaIndexState, type MediaPage, type MediaRoot, type MediaTreeNode, type MediaView} from '../../../shared/api/media-browser';
import {getActiveVaultId} from '../../../shared/api/vault-context';
import {DEFAULT_FILTERS, DEFAULT_SORT, PAGE_SIZE, mediaQuery, viewFilters, type MediaAsset, type MediaFilters, type MediaSort} from './model';

const INDEX_POLL_MS = 5_000;
const MAX_INDEX_POLLS = 60;
const MAX_PAGE_SIZE = 500;
interface CollectionSnapshot {
    scope: string;
    media: MediaAsset[];
    loading: boolean;
    hasSnapshot: boolean;
    total: number;
    hasMore: boolean;
    indexState?: MediaIndexState;
    indexError: boolean;
    indexPollingPaused: boolean;
    indexRetryBlocked: boolean;
}
function emptySnapshot(scope: string): CollectionSnapshot {
    return {scope, media: [], loading: true, hasSnapshot: false, total: 0, hasMore: false,
        indexError: false, indexPollingPaused: false, indexRetryBlocked: false};
}
function uniqueMedia(items: MediaAsset[]): MediaAsset[] {
    const seen = new Set<string>();
    return items.filter(item => {
        const key = JSON.stringify([item.root, item.path_in_root]);
        if (seen.has(key)) return false;
        seen.add(key); return true;
    });
}
function pageCursor(page: MediaPage, start: number, limit: number) {
    const next = page.nextOffset ?? start + page.items.length;
    return {next, hasMore: next > start && next < page.total
        && (page.nextOffset !== undefined || page.items.length === limit)};
}
type ReadMode = 'initial' | 'more' | 'refresh' | 'retry';

export function useMediaCollection() {
    const {t} = useTranslation();
    const vaultId = getActiveVaultId();
    const [activeAlbum, setActiveAlbum] = useState<string | null>('');
    const [activeRoot, setRoot] = useState('images');
    const [filters, setFilters] = useState<MediaFilters>({...DEFAULT_FILTERS});
    const [sort, setSort] = useState<MediaSort>({...DEFAULT_SORT});
    const [activeViewId, setActiveViewId] = useState<string | null>(null);
    const [rootSnapshot, setRootSnapshot] = useState<{vaultId: string; items: MediaRoot[]} | null>(null);
    const [albumSnapshot, setAlbumSnapshot] = useState<{scope: string; items: MediaTreeNode[]} | null>(null);
    const query = useMemo(() => mediaQuery(activeRoot, activeAlbum ?? '', 0, filters, sort), [activeRoot, activeAlbum, filters, sort]);
    const scope = JSON.stringify([vaultId, activeAlbum, query]);
    const albumScope = JSON.stringify([vaultId, activeRoot]);
    const [snapshot, setSnapshot] = useState<CollectionSnapshot>(() => emptySnapshot(scope));
    const visible = snapshot.scope === scope ? snapshot : emptySnapshot(scope);
    const commands = useRef<{scope: string; read: (mode: ReadMode) => Promise<void>} | null>(null);
    const hasActiveFilters = filters.kinds.length > 0 || filters.q.trim() !== ''
        || filters.tagsAny.length > 0 || filters.datePreset !== 'all'
        || filters.sizePreset !== 'all' || sort.field !== DEFAULT_SORT.field || sort.dir !== DEFAULT_SORT.dir;
    const resetFilters = useCallback(() => {
        setFilters({...DEFAULT_FILTERS}); setSort({...DEFAULT_SORT}); setActiveViewId(null);
    }, [setFilters, setSort, setActiveViewId]);
    const setActiveRoot = useCallback((root: string) => {setRoot(root); setActiveAlbum('');}, [setRoot, setActiveAlbum]);
    const setMedia = useCallback((update: SetStateAction<MediaAsset[]>) => {
        setSnapshot(previous => previous.scope === scope
            ? {...previous, media: typeof update === 'function' ? update(previous.media) : update} : previous);
    }, [scope]);

    useEffect(() => {
        const controller = new AbortController();
        void fetchMediaRoots(controller.signal).then(items => {
            if (!controller.signal.aborted && getActiveVaultId() === vaultId) {
                setRootSnapshot({vaultId, items: items.filter(root => root.available)});
            }
        }).catch(() => { /* Root discovery is optional. */ });
        return () => {controller.abort();};
    }, [vaultId]);
    useEffect(() => {
        const controller = new AbortController();
        void fetchMediaTree(activeRoot, undefined, controller.signal).then(items => {
            if (!controller.signal.aborted && getActiveVaultId() === vaultId) setAlbumSnapshot({scope: albumScope, items});
        }).catch(() => { /* Preserve this root's tree if its refresh fails. */ });
        return () => {controller.abort();};
    }, [activeRoot, albumScope, vaultId]);

    useEffect(() => {
        const lifetime = new AbortController();
        let pending: Promise<void> | null = null;
        let pollTimer: ReturnType<typeof setTimeout> | undefined;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        let polls = 0;
        let offset = 0;
        let revision: string | undefined;
        let hasSnapshot = false;
        const isCurrent = () => !lifetime.signal.aborted && getActiveVaultId() === vaultId;
        const update = (change: Partial<CollectionSnapshot>) => {
            if (isCurrent()) setSnapshot(previous => ({...(previous.scope === scope ? previous : emptySnapshot(scope)), ...change}));
        };
        const request = (start: number, limit = PAGE_SIZE) => fetchMediaPage(
            {...query, offset: start, limit}, lifetime.signal, 600_000);
        // A new index can move every pagination boundary. Publish its entire
        // previously loaded prefix at once, after verifying each page's revision.
        const readPrefix = async (first: MediaPage, wanted: number) => {
            let items = first.items;
            let cursor = pageCursor(first, 0, PAGE_SIZE);
            let consumed = cursor.next;
            while (consumed < Math.min(wanted, first.total) && cursor.hasMore) {
                const limit = Math.min(MAX_PAGE_SIZE, wanted - consumed);
                const page = await request(consumed, limit);
                if (!isCurrent()) return null;
                if (page.indexRevision !== first.indexRevision) throw new Error('Media index changed between pages');
                items = [...items, ...page.items];
                cursor = pageCursor(page, consumed, limit);
                consumed = cursor.next;
            }
            return {items: uniqueMedia(items), consumed, hasMore: cursor.hasMore};
        };
        const applyStatus = (page: MediaPage) => {
            globalThis.clearTimeout(retryTimer);
            const state = page.indexState ?? 'fresh';
            const retryAfter = state === 'failed' ? page.indexRetryAfter ?? 0 : 0;
            update({indexState: state, indexError: state === 'failed', indexPollingPaused: false, indexRetryBlocked: retryAfter > 0});
            if (retryAfter > 0) retryTimer = globalThis.setTimeout(() => {update({indexRetryBlocked: false});}, retryAfter * 1000);
            if (state === 'refreshing') {
                if (polls < MAX_INDEX_POLLS) pollTimer = globalThis.setTimeout(() => {polls += 1; void read('refresh');}, INDEX_POLL_MS);
                else update({indexPollingPaused: true});
            }
        };
        const performRead = async (mode: ReadMode) => {
            globalThis.clearTimeout(pollTimer);
            if (!isCurrent()) return;
            if (activeAlbum === null) {update({...emptySnapshot(scope), loading: false}); return;}
            if (mode === 'retry') polls = 0;
            update({loading: true});
            try {
                const append = mode === 'more' && hasSnapshot;
                let page = await request(append ? offset : 0);
                if (!isCurrent()) return;
                const sameRevision = hasSnapshot && page.indexRevision !== undefined && page.indexRevision === revision;
                if (append && page.indexRevision === revision) {
                    const cursor = pageCursor(page, offset, PAGE_SIZE);
                    offset = cursor.next;
                    setSnapshot(previous => previous.scope === scope
                        ? {...previous, media: uniqueMedia([...previous.media, ...page.items]), total: page.total,
                            hasMore: cursor.hasMore, hasSnapshot: true} : previous);
                } else if (mode === 'refresh' && sameRevision) {
                    update({total: page.total});
                } else {
                    const wanted = Math.max(PAGE_SIZE, offset + (append ? PAGE_SIZE : 0));
                    if (append) {
                        page = await request(0);
                        if (!isCurrent()) return;
                    }
                    const prefix = await readPrefix(page, wanted);
                    if (!prefix || !isCurrent()) return;
                    offset = prefix.consumed;
                    update({media: prefix.items, total: page.total, hasMore: prefix.hasMore, hasSnapshot: true});
                }
                hasSnapshot = true;
                revision = page.indexRevision;
                applyStatus(page);
            } catch {
                if (isCurrent()) {update({indexError: true, indexPollingPaused: false}); toast.error(t('media.load_error'));}
            } finally {update({loading: false});}
        };
        const read = (mode: ReadMode): Promise<void> => {
            if (!isCurrent()) return Promise.resolve();
            if (pending) return pending;
            const operation = performRead(mode);
            pending = operation;
            void operation.finally(() => {if (pending === operation) pending = null;});
            return operation;
        };
        const command = {scope, read};
        commands.current = command;
        queueMicrotask(() => {if (isCurrent()) {setSnapshot(emptySnapshot(scope)); void read('initial');}});
        return () => {
            lifetime.abort();
            globalThis.clearTimeout(pollTimer); globalThis.clearTimeout(retryTimer);
            if (commands.current === command) commands.current = null;
        };
    }, [activeAlbum, query, scope, t, vaultId]);

    const fetchMedia = useCallback((reset = false) => {
        const command = commands.current;
        return command?.scope === scope ? command.read(reset ? 'retry' : 'more') : Promise.resolve();
    }, [scope]);
    const applyView = useCallback((view: MediaView) => {
        setActiveViewId(view.id); setRoot(view.scope?.root || 'images'); setActiveAlbum(view.scope?.album || '');
        setFilters(viewFilters(view)); setSort({...DEFAULT_SORT, ...view.sort});
    }, [setActiveViewId, setRoot, setActiveAlbum, setFilters, setSort]);
    return {...visible, setMedia, albums: albumSnapshot?.scope === albumScope ? albumSnapshot.items : [],
        activeAlbum, setActiveAlbum, roots: rootSnapshot?.vaultId === vaultId ? rootSnapshot.items : [], activeRoot, setActiveRoot,
        filters, setFilters, sort, setSort, activeViewId, setActiveViewId, hasActiveFilters, resetFilters, fetchMedia, applyView};
}
export type MediaCollection = ReturnType<typeof useMediaCollection>;
