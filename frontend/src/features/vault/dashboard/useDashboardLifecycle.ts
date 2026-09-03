import { useEffect, useEffectEvent, useRef } from 'react';
import { subscribeDocumentEvent, subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { writeStorage } from '../../../shared/platform/browser-storage';
import { getTableIdFromTab } from './tab-model';
import { EDIT_LOCKS } from './storage';
import type { DashboardActions } from './useDashboardActions';
export function useDashboardLifecycle(context: DashboardActions) {
    const { nestedPath, registry, activeTableId, visibleTableRecordsById, pages, loading, isRegistryLoading, activeTabId, viewMode, editLockedByPageId, activeLoadAbortRef, pageRequestAbortersRef, fetchPagesRetryTimerRef } = context;
    const initializedRef = useRef(false);
    const initialize = useEffectEvent(() => {
        void context.fetchPages();
        void context.fetchRegistry();
    });
    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;
        initialize();
    }, []);
    useEffect(() => { writeStorage(EDIT_LOCKS, editLockedByPageId); }, [editLockedByPageId]);
    const cancelRetry = useEffectEvent(() => {
        if (fetchPagesRetryTimerRef.current)
            clearTimeout(fetchPagesRetryTimerRef.current);
    });
    useEffect(() => {
        const aborters = pageRequestAbortersRef.current;
        return () => {
            activeLoadAbortRef.current?.abort();
            activeLoadAbortRef.current = null;
            aborters.forEach(controller => { controller.abort(); });
            aborters.clear();
            cancelRetry();
        };
    }, [activeLoadAbortRef, pageRequestAbortersRef, fetchPagesRetryTimerRef]);
    const synchronizeRoute = useEffectEvent(() => {
        const { setActiveTabId, setActiveTableId, setViewMode, setActiveViewId, setTabs, activeViewId, handleTableSelect, loadPage, pagesRef, t } = context;
        if (!nestedPath) {
            setActiveTabId(null);
            setActiveTableId(null);
            setViewMode('editor');
            return;
        }
        const parts = nestedPath.split('/');
        if (parts[0] === 'table' && parts[1]) {
            const tableId = parts[1];
            const viewId = parts[3];
            // Wait for the registry before selecting a direct table route, so its schema is loaded.
            if (!registry.tables.some(table => table.id === tableId))
                return;
            if (activeTableId !== tableId)
                void handleTableSelect(tableId, viewId, true);
            else if (viewId && activeViewId !== viewId)
                setActiveViewId(viewId);
        }
        else if ((parts[0] === 'page' || parts[0] === 'dashboard') && parts[1]) {
            const pageId = parts.slice(1).join('/');
            if (activeTabId !== pageId)
                void loadPage(pageId, true);
        }
        else if (parts[0] === 'drawing') {
            const drawingId = parts.slice(1).join('/');
            if (drawingId) {
                setTabs(previous => previous.some(tab => tab.id === drawingId) ? previous
                    : [...previous, { id: drawingId, title: t('common.untitled'), isDrawing: true }]);
                setActiveTabId(drawingId);
                setActiveTableId(null);
            }
            if (viewMode !== 'drawing')
                setViewMode('drawing');
        }
        else if (parts[0] === 'view' && parts[1]) {
            const id = parts[1];
            const table = registry.tables.find(candidate => candidate.id === id || candidate.name.toLowerCase() === id.toLowerCase());
            if (table && table.id !== activeTableId)
                void handleTableSelect(table.id, null, true);
            else if (!table) {
                const page = pagesRef.current.find(candidate => candidate.id === id);
                if (page)
                    void loadPage(page.id, true);
            }
        }
    });
    useEffect(() => { synchronizeRoute(); }, [nestedPath, registry.tables]);
    const refreshActiveTable = useEffectEvent(() => {
        if (activeTableId)
            void context.fetchPagesByTable(activeTableId);
    });
    useEffect(() => {
        const offFocus = subscribeWindowEvent('focus', () => { refreshActiveTable(); });
        const offVisibility = subscribeDocumentEvent('visibilitychange', () => {
            if (document.visibilityState === 'visible')
                refreshActiveTable();
        });
        return () => { offFocus(); offVisibility(); };
    }, []);
    const synchronizeNotes = useEffectEvent(() => {
        if (!activeTableId)
            return;
        const notes = visibleTableRecordsById[activeTableId];
        if (notes !== undefined)
            context.setTableNotes(notes);
    });
    useEffect(() => { synchronizeNotes(); }, [activeTableId, visibleTableRecordsById]);
    const pruneTabs = useEffectEvent(() => {
        if (loading || isRegistryLoading)
            return;
        const { setTabs, setSplitTabIds, setSplitTableIds, setActiveTabId, setActiveTableId, setViewMode } = context;
        const pageIds = new Set(pages.map(page => page.id));
        const tableIds = new Set(registry.tables.map(table => table.id));
        setTabs(previous => {
            const filtered = previous.filter(tab => {
                if (tab.isTable) {
                    const tableId = getTableIdFromTab(tab);
                    return Boolean(tableId && tableIds.has(tableId));
                }
                if (tab.isPdf || tab.isDrawing || tab.id === activeTabId || tab.content !== undefined)
                    return true;
                return pageIds.has(tab.id);
            });
            if (filtered.length === previous.length)
                return previous;
            const validIds = new Set(filtered.map(tab => tab.id));
            setSplitTabIds(current => current.filter(id => validIds.has(id)));
            if (activeTabId && !validIds.has(activeTabId)) {
                const fallback = filtered.at(-1);
                setActiveTabId(fallback?.id || null);
                if (fallback) {
                    setActiveTableId(fallback.isTable ? getTableIdFromTab(fallback) : null);
                    setViewMode(fallback.isDrawing ? 'drawing' : 'editor');
                }
            }
            return filtered;
        });
        setSplitTableIds(previous => previous.filter(id => tableIds.has(id)));
        if (activeTableId && !tableIds.has(activeTableId)) {
            setActiveTableId(null);
            if (viewMode === 'table')
                setViewMode('editor');
        }
    });
    useEffect(() => { pruneTabs(); }, [activeTabId, activeTableId, pages, registry.tables, viewMode, loading, isRegistryLoading]);
}
