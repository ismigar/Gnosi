import { useCallback } from 'react';
import { fetchVaultSidebarSummary } from '../../../shared/api/vaults';
import { fetchVaultPages } from '../../../shared/api/vaults';
import { fetchVaultPagesByTable } from '../../../shared/api/vaults';
import { fetchVaultRegistry } from '../../../shared/api/vaults';
import { fetchVaultTablePagesSnapshot } from '../../../shared/api/vaults';
import { toast } from '../../../shared/notifications/toast';
import { logError } from '../../../shared/notifications/notifyError';
import { notifyError } from '../../../shared/notifications/notifyError';
import { isAbortLikeError } from './readers';
import { readPages } from './readers';
import { readRegistry, retryAfter } from './readers';
import { errorStatus } from './readers';
import type { Page, TranslatedResult } from './types';
import type { DashboardState } from './useDashboardState';
import type { useGlobalIndex } from './useGlobalIndex';
import type { useRecordCatalog } from './useRecordCatalog';
type Context = Pick<DashboardState, 'fetchPagesRetryTimerRef' | 'fullPageCatalogLoadedRef' | 'pages' | 'setGlobalIndex' | 'setIsRegistryLoading' | 'setLoading' | 'setPages' | 'setRegistry' | 'setTableCountsById' | 'setTableTemplates' | 'setVisibleTableRecordsById' | 't'> & Pick<ReturnType<typeof useGlobalIndex>, 'fetchGlobalIndex'> & Pick<ReturnType<typeof useRecordCatalog>, 'resolvePageTableId' | 'shouldIncludeTableRecord' | 'syncPagesState'>;
export function useDataLoading(context: Context) {
    const { fetchGlobalIndex, fetchPagesRetryTimerRef, fullPageCatalogLoadedRef, resolvePageTableId, setGlobalIndex, setIsRegistryLoading, setLoading, setPages, setRegistry, setTableCountsById, setTableTemplates, setVisibleTableRecordsById, shouldIncludeTableRecord, syncPagesState, t } = context;
    const FETCH_PAGES_MAX_ATTEMPTS = 8;
    const fetchPages = useCallback(async function fetchPages(attempt = 0): Promise<Page[]> {
        try {
            setLoading(true);
            const nextPages = readPages(await (
                fullPageCatalogLoadedRef.current
                    ? fetchVaultPages()
                    : fetchVaultSidebarSummary()
            ));
            if (nextPages.length === 0 && attempt < FETCH_PAGES_MAX_ATTEMPTS) {
                // Backend cache may still be warming up — retry with backoff
                if (fetchPagesRetryTimerRef.current)
                    clearTimeout(fetchPagesRetryTimerRef.current);
                fetchPagesRetryTimerRef.current = setTimeout(() => { void fetchPages(attempt + 1); }, Math.min(1000 * (attempt + 1), 5000));
                return [];
            }
            syncPagesState(nextPages);
            setLoading(false);
            return nextPages;
        }
        catch (err) {
            if (isAbortLikeError(err) && attempt < 2) {
                if (fetchPagesRetryTimerRef.current)
                    clearTimeout(fetchPagesRetryTimerRef.current);
                fetchPagesRetryTimerRef.current = setTimeout(() => { void fetchPages(attempt + 1); }, 400 * (attempt + 1));
                return [];
            }
            // 503 with Retry-After: the backend tells us the index is still
            // warming up. We retry honoring the header (fallback 2s).
            if (errorStatus(err) === 503 && attempt < FETCH_PAGES_MAX_ATTEMPTS) {
                const retrySeconds = retryAfter(err);
                if (fetchPagesRetryTimerRef.current)
                    clearTimeout(fetchPagesRetryTimerRef.current);
                fetchPagesRetryTimerRef.current = setTimeout(() => { void fetchPages(attempt + 1); }, Math.min(retrySeconds * 1000, 5000));
                return [];
            }
            notifyError('load-pages', err, t('errors.load_pages'));
            setLoading(false);
            return [];
        }
    }, [setLoading, syncPagesState, fetchPagesRetryTimerRef, fullPageCatalogLoadedRef, t]);
    const fetchFullPages = useCallback(async (): Promise<Page[]> => {
        fullPageCatalogLoadedRef.current = true;
        return fetchPages();
    }, [fetchPages, fullPageCatalogLoadedRef]);
    const fetchRegistry = useCallback(async function fetchRegistry(attempt = 0): Promise<void> {
        if (attempt === 0) {
            setIsRegistryLoading(true);
        }
        try {
            const nextRegistry = await fetchVaultRegistry();
            setRegistry(readRegistry(nextRegistry));
            setIsRegistryLoading(false);
        }
        catch (err) {
            // Log every retry attempt; only toast on the final failure to avoid
            // a chain of "load failed" toasts during transient warm-up errors.
            logError('load-registry', err);
            if (attempt < 2) {
                setTimeout(() => { void fetchRegistry(attempt + 1); }, 800);
                return;
            }
            notifyError('load-registry', err, t('errors.load_registry'));
            setIsRegistryLoading(false);
            toast.error(t('errors.connection'));
        }
    }, [setIsRegistryLoading, setRegistry, t]);
    const fetchPagesByTable = useCallback(async (tableId: string | null) => {
        if (!tableId)
            return [];
        try {
            const tablePages = readPages(await fetchVaultPagesByTable(tableId));
            const templates = tablePages.filter(p => p.metadata?.is_template);
            setTableTemplates(templates);
            setPages(prevPages => {
                const nonTablePages = prevPages.filter(p => resolvePageTableId(p) !== tableId);
                const merged = [...nonTablePages, ...tablePages];
                setGlobalIndex(prev => ({
                    ...prev,
                    ...Object.fromEntries(merged.map(page => [page.id, page.title || t('common.untitled')]))
                }));
                return merged;
            });
            void fetchGlobalIndex();
            try {
                const snapshot = await fetchVaultTablePagesSnapshot(tableId);
                const visiblePages = readPages(snapshot.pages);
                setVisibleTableRecordsById(prev => ({ ...prev, [tableId]: visiblePages }));
                setTableCountsById(prev => ({
                    ...prev,
                    [tableId]: {
                        raw: (snapshot.raw_count || tablePages.length),
                        visible: (snapshot.visible_count || visiblePages.length),
                    }
                }));
            }
            catch (snapshotErr) {
                const fallbackVisible = tablePages.filter(page => shouldIncludeTableRecord(page, tableId, tablePages));
                setVisibleTableRecordsById(prev => ({ ...prev, [tableId]: fallbackVisible }));
                setTableCountsById(prev => ({
                    ...prev,
                    [tableId]: { raw: tablePages.length, visible: fallbackVisible.length }
                }));
                console.warn('Could not load canonical table snapshot, using local calculation:', snapshotErr);
            }
            return tablePages;
        }
        catch (err) {
            if (isAbortLikeError(err))
                return [];
            logError('load-table-pages', err);
            return [];
        }
    }, [fetchGlobalIndex, resolvePageTableId, setGlobalIndex, setPages, setTableCountsById, setTableTemplates, setVisibleTableRecordsById, shouldIncludeTableRecord, t]);
    const refreshTableAfterTranslate = useCallback(async (tableId: string | null, data: TranslatedResult = {}) => {
        const expectedIds = [
            ...(data.created || []),
            ...(data.updated || []),
            // translate-rows (bulk) wraps each row's result inside `results`.
            ...((data.results || []).flatMap(r => [...(r.created || []), ...(r.updated || [])])),
        ].map(x => x.id).filter((id): id is string => typeof id === 'string' && Boolean(id));
        let pages = tableId ? await fetchPagesByTable(tableId) : [];
        // Newly created pages can take a while to become visible in the
        // backend index (indexing under OneDrive: measured up to ~10s). We retry with
        // growing backoff up to ~15s: the first attempts are fast (the
        // normal case → it stops right away) and the last ones more spaced out to cover the
        // lag without flooding it with requests. Before, it was 6×500ms=3s and it would time out.
        const backoffMs = [400, 700, 1100, 1600, 2200, 3000, 3000, 3000];
        for (const delay of backoffMs) {
            if (!expectedIds.length)
                break;
            const have = new Set(pages.map(p => p.id));
            if (expectedIds.every(id => have.has(id)))
                break;
            await new Promise(resolve => setTimeout(resolve, delay));
            if (tableId)
                pages = await fetchPagesByTable(tableId);
        }
        await fetchPages();
    }, [fetchPagesByTable, fetchPages]);
    return { fetchPages, fetchFullPages, fetchRegistry, fetchPagesByTable, refreshTableAfterTranslate };
}
