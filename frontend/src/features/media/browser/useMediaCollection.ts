import {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import toast from '../../../shared/notifications/toast';
import {fetchMediaPage, fetchMediaRoots, fetchMediaTree, type MediaRoot, type MediaTreeNode, type MediaView} from '../../../shared/api/media-browser';
import {DEFAULT_FILTERS, DEFAULT_SORT, PAGE_SIZE, mediaQuery, viewFilters, type MediaAsset, type MediaFilters, type MediaSort} from './model';

export function useMediaCollection() {
    const {t} = useTranslation();
    const [media, setMedia] = useState<MediaAsset[]>([]);
    const [albums, setAlbums] = useState<MediaTreeNode[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeAlbum, setActiveAlbum] = useState<string | null>(null);
    const [roots, setRoots] = useState<MediaRoot[]>([]);
    const [activeRoot, setActiveRoot] = useState('images');
    const [offset, setOffset] = useState(0);
    const [total, setTotal] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [filters, setFilters] = useState<MediaFilters>({...DEFAULT_FILTERS});
    const [sort, setSort] = useState<MediaSort>({...DEFAULT_SORT});
    const [activeViewId, setActiveViewId] = useState<string | null>(null);
    const applyingViewRef = useRef(false);
    const hasActiveFilters = filters.kinds.length > 0 || filters.q.trim() !== ''
        || filters.tagsAny.length > 0 || filters.datePreset !== 'all'
        || filters.sizePreset !== 'all' || sort.field !== DEFAULT_SORT.field || sort.dir !== DEFAULT_SORT.dir;
    const resetFilters = useCallback(() => {
        setFilters({...DEFAULT_FILTERS}); setSort({...DEFAULT_SORT}); setActiveViewId(null);
    }, []);
    const fetchAlbums = useCallback(async (root: string) => {
        try {setAlbums(await fetchMediaTree(root));}
        catch { /* Preserve the previous tree if its refresh fails. */ }
    }, []);
    const loadPage = useCallback(async (reset: boolean, currentOffset: number) => {
        if (activeAlbum === null) {
            setMedia([]); setTotal(0); setHasMore(false); setLoading(false); return;
        }
        try {
            setLoading(true);
            const {items, total: totalCount} = await fetchMediaPage(
                mediaQuery(activeRoot, activeAlbum, currentOffset, filters, sort), undefined, 600_000);
            if (reset) {setMedia(items); setOffset(items.length);}
            else {setMedia(previous => [...previous, ...items]); setOffset(previous => previous + items.length);}
            setTotal(totalCount); setHasMore(items.length === PAGE_SIZE);
        } catch {toast.error(t('media.load_error'));}
        finally {setLoading(false);}
    }, [activeAlbum, activeRoot, filters, sort, t]);
    const fetchMedia = (reset = false) => loadPage(reset, reset ? 0 : offset);
    useEffect(() => {
        let cancelled = false;
        void fetchMediaRoots().then(response => {
            if (!cancelled) setRoots(response.filter(root => root.available));
        }).catch(() => { /* Root discovery is optional; keep the active root usable. */ });
        return () => {cancelled = true;};
    }, []);
    useEffect(() => {
        let cancelled = false;
        void Promise.resolve().then(() => {
            if (cancelled) return;
            void fetchAlbums(activeRoot);
            if (applyingViewRef.current) applyingViewRef.current = false;
            else setActiveAlbum('');
            setMedia([]); setOffset(0);
        });
        return () => {cancelled = true;};
    }, [activeRoot, fetchAlbums]);
    useEffect(() => {
        let cancelled = false;
        void Promise.resolve().then(() => {if (!cancelled) void loadPage(true, 0);});
        return () => {cancelled = true;};
    }, [loadPage]);
    const applyView = useCallback((view: MediaView) => {
        const targetRoot = view.scope?.root || 'images';
        if (targetRoot !== activeRoot) applyingViewRef.current = true;
        setActiveViewId(view.id); setActiveRoot(targetRoot); setActiveAlbum(view.scope?.album || '');
        setFilters(viewFilters(view)); setSort({...DEFAULT_SORT, ...view.sort});
    }, [activeRoot]);
    return {media, setMedia, albums, loading, activeAlbum, setActiveAlbum, roots, activeRoot, setActiveRoot,
        total, hasMore, filters, setFilters, sort, setSort, activeViewId, setActiveViewId,
        hasActiveFilters, resetFilters, fetchMedia, applyView};
}
export type MediaCollection = ReturnType<typeof useMediaCollection>;
