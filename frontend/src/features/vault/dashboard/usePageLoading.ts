import { useCallback } from 'react';
import { fetchVaultPage } from '../../../shared/api/vaults';
import { resolveVaultTitle } from '../../../shared/api/vaults';
import { toast } from '../../../shared/notifications/toast';
import { notifyError } from '../../../shared/notifications/notifyError';
import { inFlightSaves } from '../editor/editorState';
import { knowledgeDocumentType } from '../../../shared/routing/vaultRouting';
import { vaultPath } from '../../../shared/routing/vaultRouting';
import { isAbortLikeError } from './readers';
import { text, wasAborted } from './readers';
import type { PageResponse } from './types';
import { readPage } from './readers';
import type { OpenRecordContext } from './types';
import type { DashboardState } from './useDashboardState';
import type { useDataLoading } from './useDataLoading';
import type { useNavigationHistory } from './useNavigationHistory';
import type { useRecordCatalog } from './useRecordCatalog';
type Context = Pick<DashboardState, 'activeLoadAbortRef' | 'setConsumedRecordReturnFocus' | 'consumedRecordReturnFocusRef' | 'globalIndex' | 'navigate' | 'nestedPath' | 'pageRequestAbortersRef' | 'pageRequestInFlightRef' | 'pages' | 'pagesRef' | 'recordReturnFocusSequenceRef' | 'setActiveTabId' | 'setActiveTableId' | 'setRecordReturnFocus' | 'setTabs' | 'setViewMode' | 't' | 'tabs'> & Pick<ReturnType<typeof useDataLoading>, 'fetchFullPages' | 'fetchPagesByTable'> & Pick<ReturnType<typeof useNavigationHistory>, 'pushToHistory'> & Pick<ReturnType<typeof useRecordCatalog>, 'resolvePageTableId'>;
export function usePageLoading(context: Context) {
    const { activeLoadAbortRef, consumedRecordReturnFocusRef, setConsumedRecordReturnFocus, fetchFullPages, fetchPagesByTable, globalIndex, navigate, nestedPath, pageRequestAbortersRef, pageRequestInFlightRef, pagesRef, pushToHistory, recordReturnFocusSequenceRef, resolvePageTableId, setActiveTabId, setActiveTableId, setRecordReturnFocus, setTabs, setViewMode, t, tabs } = context;
    const fetchPageById = useCallback(async (pageId: string, maxAbortRetries = 1, externalSignal: AbortSignal | null = null): Promise<PageResponse | null> => {
        if (!pageId)
            return null;
        const existingRequest = pageRequestInFlightRef.current.get(pageId);
        if (existingRequest) {
            return existingRequest;
        }
        // Per-pageId controller so that an external signal from the caller can
        // abort the underlying axios call (e.g. when the user navigates away).
        const controller = new AbortController();
        pageRequestAbortersRef.current.set(pageId, controller);
        const onExternalAbort = () => { controller.abort(); };
        if (externalSignal) {
            if (externalSignal.aborted) {
                controller.abort();
            }
            else {
                externalSignal.addEventListener('abort', onExternalAbort, { once: true });
            }
        }
        const requestPromise = (async () => {
            let lastErr: unknown = null;
            for (let attempt = 0; attempt <= maxAbortRetries; attempt += 1) {
                try {
                    const page = readPage(await fetchVaultPage(pageId, controller.signal));
                    return { data: page };
                }
                catch (err) {
                    lastErr = err;
                    // If the external caller aborted, propagate immediately.
                    if (externalSignal?.aborted)
                        throw err;
                    if (isAbortLikeError(err) && attempt < maxAbortRetries) {
                        await new Promise(resolve => setTimeout(resolve, 60));
                        continue;
                    }
                    throw err;
                }
            }
            throw lastErr;
        })();
        pageRequestInFlightRef.current.set(pageId, requestPromise);
        try {
            // Check if there is an in-flight save for this page.
            // If so, we want to return a mock response with the in-flight content
            // to prevent the user from seeing stale data while the save is still processing.
            const inFlight = inFlightSaves.get(pageId);
            if (inFlight) {
                return {
                    data: {
                        id: pageId,
                        title: text(inFlight.metadata.title) || t('common.untitled'),
                        content: inFlight.content,
                        metadata: inFlight.metadata,
                        last_modified: new Date(inFlight.timestamp).toISOString()
                    }
                };
            }
            return await requestPromise;
        }
        finally {
            pageRequestInFlightRef.current.delete(pageId);
            pageRequestAbortersRef.current.delete(pageId);
            if (externalSignal) {
                externalSignal.removeEventListener('abort', onExternalAbort);
            }
        }
    }, [pageRequestAbortersRef, pageRequestInFlightRef, t]);
    const loadPage = useCallback(async function loadPage(pageId: string, fromHistory = false, attempt = 0): Promise<void> {
        if (!pageId)
            return;
        // If the wikilink passed a literal title instead of a UUID
        // (e.g. "Resum estructurat del DVA"), we now resolve it against
        // `globalIndex` or `pages`. Without this, GET /api/vault/pages/<title>
        // returns 404. globalIndex can be empty on the first load
        // if the search is immediate; that's why there's a second fallback to
        // `pages` and a third fallback to the backend (`/resolve-by-title`)
        // — this last one covers moves where globalIndex hasn't yet
        // refreshed on the frontend.
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!UUID_RE.test(pageId)) {
            const lower = pageId.toLowerCase().trim();
            let resolved = null;
            // 1) globalIndex
            for (const [id, title] of Object.entries(globalIndex)) {
                if ((title || '').toLowerCase().trim() === lower) {
                    resolved = id;
                    break;
                }
            }
            // 2) Local list of pages
            if (!resolved) {
                const match = (pagesRef.current).find(p => (p.title || '').toLowerCase().trim() === lower);
                if (match)
                    resolved = match.id;
            }
            // 3) Backend (/resolve-by-title) — tolerant a moves recents.
            if (!resolved) {
                try {
                    const match = await resolveVaultTitle(pageId);
                    if (match.id)
                        resolved = match.id;
                }
                catch { /* ignore — we'll fall back to the standard 404 */ }
            }
            if (resolved && resolved !== pageId) {
                pageId = resolved;
            }
        }
        const tabId = pageId;
        const existingTab = tabs.find(t => t.id === tabId);
        if (existingTab) {
            const resourceType = knowledgeDocumentType(existingTab);
            if (fromHistory && nestedPath?.startsWith('page/') && resourceType === 'dashboard') {
                void navigate(vaultPath('knowledge', `dashboard/${encodeURIComponent(pageId)}`), { replace: true });
            }
            // No request in flight: we just change the focus.
            if (activeLoadAbortRef.current) {
                activeLoadAbortRef.current.abort();
                activeLoadAbortRef.current = null;
            }
            setActiveTabId(tabId);
            setViewMode('editor');
            setActiveTableId(null);
            if (!fromHistory)
                pushToHistory({ type: 'editor', id: pageId, resourceType });
            return;
        }
        // WARNING: if the user double-clicks the SAME wikilink, before
        // we used to abort the first loadPage and the second one would reuse the
        // requestPromise avortada → loadPage fallava silenciosament i
        // it took 2-3 more clicks for it to finally work. If the same
        // pageId is already loading, we don't abort; we let the first
        // call finishes and we exit without doing anything.
        const inFlightForSamePage = pageRequestInFlightRef.current.has(pageId);
        if (inFlightForSamePage) {
            // We wait for the result of the first call and, when it finishes,
            // setActiveTabId to ensure focus on the new page.
            try {
                const res = await pageRequestInFlightRef.current.get(pageId);
                if (res?.data) {
                    const resourceType = knowledgeDocumentType(res.data);
                    setActiveTabId(tabId);
                    setViewMode('editor');
                    setActiveTableId(null);
                    if (!fromHistory)
                        pushToHistory({ type: 'editor', id: pageId, resourceType });
                }
            }
            catch { /* the first call will already report errors */ }
            return;
        }
        // We only abort if the previous load was for a DIFFERENT pageId
        // (the user has changed target). For the same pageId we end up
        // of handling it as well.
        if (activeLoadAbortRef.current) {
            activeLoadAbortRef.current.abort();
        }
        const controller = new AbortController();
        activeLoadAbortRef.current = controller;
        try {
            // Opening one page must not wait for the whole vault catalog.
            // Keep enriching links/relations in the background as before.
            void fetchFullPages().catch((err: unknown) => { notifyError('load-pages', err, t('errors.load_pages')); });
            const res = await fetchPageById(pageId, 1, controller.signal);
            if (wasAborted(controller.signal))
                return;
            if (!res)
                return;
            const pageData = res.data;
            const resourceType = knowledgeDocumentType(pageData);
            if (fromHistory && nestedPath?.startsWith('page/') && resourceType === 'dashboard') {
                void navigate(vaultPath('knowledge', `dashboard/${encodeURIComponent(pageId)}`), { replace: true });
            }
            const tableIdOfPage = resolvePageTableId(pageData);
            if (tableIdOfPage)
                void fetchPagesByTable(tableIdOfPage).catch((err: unknown) => { notifyError('load-table-pages', err, t('errors.load_pages')); });
            if (wasAborted(controller.signal))
                return;
            const newTab = {
                id: tabId,
                title: pageData.title || t('common.untitled'),
                content: pageData.content || "",
                metadata: pageData.metadata || {},
                isTable: false
            };
            setTabs(prev => (prev.some(t => t.id === newTab.id) ? prev : [...prev, newTab]));
            setActiveTabId(tabId);
            setViewMode('editor');
            setActiveTableId(null);
            if (!fromHistory)
                pushToHistory({ type: 'editor', id: pageId, resourceType });
        }
        catch (err) {
            if (controller.signal.aborted || isAbortLikeError(err)) {
                // Aborted by a newer loadPage — silent, not a real error.
                if (controller.signal.aborted)
                    return;
                if (attempt < 2) {
                    setTimeout(() => { void loadPage(pageId, fromHistory, attempt + 1); }, 400);
                    return;
                }
            }
            notifyError('load-page', err, t('errors.load_page'));
        }
        finally {
            if (activeLoadAbortRef.current === controller) {
                activeLoadAbortRef.current = null;
            }
        }
    }, [activeLoadAbortRef, fetchFullPages, fetchPageById, fetchPagesByTable, globalIndex, navigate, nestedPath, pageRequestInFlightRef, pagesRef, pushToHistory, resolvePageTableId, setActiveTabId, setActiveTableId, setTabs, setViewMode, t, tabs]);
    const openRecordFromView = useCallback((pageId: string, tableId: string | null, viewId: string | null | undefined, openContext: OpenRecordContext | null = null) => {
        const sourceRecordId = openContext?.returnFocusId;
        if (sourceRecordId && tableId) {
            recordReturnFocusSequenceRef.current += 1;
            consumedRecordReturnFocusRef.current = null;
            setRecordReturnFocus({
                recordId: sourceRecordId,
                tableId,
                viewId: viewId || null,
                requestId: recordReturnFocusSequenceRef.current,
                isArmed: false,
            });
        }
        return loadPage(pageId);
    }, [consumedRecordReturnFocusRef, loadPage, recordReturnFocusSequenceRef, setRecordReturnFocus]);
    const handleRecordFocusRestored = useCallback((requestId?: number) => {
        consumedRecordReturnFocusRef.current = requestId ?? null;
        setConsumedRecordReturnFocus(requestId ?? null);
    }, [consumedRecordReturnFocusRef, setConsumedRecordReturnFocus]);
    const ensurePageTabLoaded = useCallback(async (pageId: string) => {
        const existingTab = tabs.find(t => t.id === pageId);
        if (existingTab) {
            return true;
        }
        try {
            const res = await fetchPageById(pageId, 1);
            if (!res)
                return false;
            const newTab = {
                id: pageId,
                title: res.data.title || t('common.untitled'),
                content: res.data.content,
                metadata: {
                    ...(res.data.metadata || {}),
                    resolved_table_id: res.data.resolved_table_id || res.data.metadata?.resolved_table_id || null,
                },
                folder: res.data.folder || "",
                resolved_table_id: res.data.resolved_table_id || null
            };
            setTabs(prev => (prev.some(t => t.id === newTab.id) ? prev : [...prev, newTab]));
            return true;
        }
        catch (err) {
            if (isAbortLikeError(err)) {
                return false;
            }
            console.error(`Error trying to preload page ${pageId}`, err);
            toast.error(t('errors.open_parallel'));
            return false;
        }
    }, [tabs, fetchPageById, t, setTabs]);
    return { fetchPageById, loadPage, openRecordFromView, handleRecordFocusRestored, ensurePageTabLoaded };
}
