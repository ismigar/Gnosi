import { useCallback } from 'react';
import { toast } from '../../../shared/notifications/toast';
import { knowledgeDocumentType } from '../../../shared/routing/vaultRouting';
import { getTableIdFromTab } from './tab-model';
import type { DashboardState } from './useDashboardState';
import type { useNavigationHistory } from './useNavigationHistory';
import type { usePageLoading } from './usePageLoading';
import type { useTableNavigation } from './useTableNavigation';
type Context = Pick<DashboardState, 'activeLoadAbortRef' | 'pageRequestAbortersRef' | 'activeTabId' | 'setActiveTabId' | 'setActiveTableId' | 'setRecordReturnFocus' | 'setSplitTabIds' | 'setSplitTableIds' | 'setTabs' | 'setViewMode' | 'splitTabIds' | 'splitTableIds' | 't' | 'tabs'> & Pick<ReturnType<typeof useNavigationHistory>, 'pushToHistory'> & Pick<ReturnType<typeof usePageLoading>, 'ensurePageTabLoaded' | 'loadPage'> & Pick<ReturnType<typeof useTableNavigation>, 'handleTableSelect'>;
export function useDocumentTabs(context: Context) {
    const { activeLoadAbortRef, pageRequestAbortersRef, activeTabId, ensurePageTabLoaded, handleTableSelect, loadPage, pushToHistory, setActiveTabId, setActiveTableId, setRecordReturnFocus, setSplitTabIds, setSplitTableIds, setTabs, setViewMode, splitTabIds, splitTableIds, t, tabs } = context;
    const MAX_PANES = 4;
    const handleTabClose = useCallback((tabId: string) => {
        const closingTab = tabs.find(tab => tab.id === tabId);
        const remainingTabs = tabs.filter(tab => tab.id !== tabId);
        const remainingSplitTabIds = splitTabIds.filter(id => id !== tabId);
        setTabs(current => current.filter(tab => tab.id !== tabId));
        setSplitTabIds(current => current.filter(id => id !== tabId));
        if (activeTabId !== tabId) return;
        // A route-triggered duplicate load must not resurrect a closed record.
        activeLoadAbortRef.current?.abort();
        activeLoadAbortRef.current = null;
        pageRequestAbortersRef.current.get(tabId)?.abort();

        const origin = closingTab?.origin;
        if (origin && (origin.tableId || origin.tabId)) {
            setRecordReturnFocus(current => current?.tableId === origin.tableId
                ? { ...current, isArmed: true } : current);
            const originTab = remainingTabs.find(tab => tab.id === origin.tabId);
            if (originTab) {
                if (!closingTab?.kind) pushToHistory(originTab.isTable
                    ? { type: 'table', id: getTableIdFromTab(originTab), subId: origin.viewId }
                    : { type: 'editor', id: originTab.id, resourceType: knowledgeDocumentType(originTab) });
                setActiveTabId(originTab.id);
                setActiveTableId(originTab.isTable ? getTableIdFromTab(originTab) : null);
                setViewMode(originTab.isDrawing ? 'drawing' : 'editor');
                setSplitTabIds(current => current.filter(id => id !== originTab.id && id !== tabId));
                return;
            }
            if (origin.tableId) {
                if (!closingTab?.kind) pushToHistory({ type: 'table', id: origin.tableId, subId: origin.viewId });
                void handleTableSelect(origin.tableId, origin.viewId || null, true);
                setSplitTabIds([]);
                return;
            }
        }
        const nextActiveTabId = remainingSplitTabIds.find(id => remainingTabs.some(tab => tab.id === id))
            || remainingTabs.at(-1)?.id || null;
        if (nextActiveTabId) {
            const nextTab = remainingTabs.find(tab => tab.id === nextActiveTabId);
            setActiveTabId(nextActiveTabId);
            setActiveTableId(nextTab?.isTable ? getTableIdFromTab(nextTab) : null);
            setViewMode(nextTab?.isDrawing ? 'drawing' : 'editor');
            setSplitTabIds(current => current.filter(id => id !== nextActiveTabId && id !== tabId));
        } else if (splitTableIds[0]) {
            const promotedTableId = splitTableIds[0];
            setSplitTableIds(current => current.filter(id => id !== promotedTableId));
            void handleTableSelect(promotedTableId);
        } else {
            setActiveTabId(null);
        }
    }, [activeLoadAbortRef, pageRequestAbortersRef, tabs, splitTabIds, pushToHistory, setRecordReturnFocus, setTabs, setSplitTabIds, activeTabId, splitTableIds, setActiveTabId, setActiveTableId, setViewMode, handleTableSelect, setSplitTableIds]);
    const handleToggleSplit = useCallback((tabId: string) => {
        if (tabId === activeTabId)
            return;
        setSplitTabIds(prev => {
            if (prev.includes(tabId))
                return prev.filter(id => id !== tabId);
            if (prev.length + splitTableIds.length + 1 >= MAX_PANES)
                return prev; // already have active + prev
            return [...prev, tabId];
        });
    }, [activeTabId, setSplitTabIds, splitTableIds.length]);
    const handleOpenParallel = useCallback(async (pageId: string) => {
        if (pageId === activeTabId)
            return;
        const loaded = await ensurePageTabLoaded(pageId);
        if (!loaded)
            return;
        setSplitTabIds(prev => {
            if (prev.includes(pageId))
                return prev;
            if (prev.length + splitTableIds.length + 1 >= MAX_PANES)
                return prev;
            return [...prev, pageId];
        });
    }, [activeTabId, ensurePageTabLoaded, setSplitTabIds, splitTableIds.length]);
    const handleOpenInCurrentTab = useCallback(async (pageId: string) => {
        if (!pageId)
            return;
        if (pageId === activeTabId)
            return;
        const previousTabId = activeTabId;
        await loadPage(pageId);
        // Closes the previous tab only if it still exists and hasn't been promoted to the new one.
        if (previousTabId && previousTabId !== pageId) {
            setTabs(prev => prev.filter(t => t.id !== previousTabId));
            setSplitTabIds(prev => prev.filter(id => id !== previousTabId));
        }
    }, [activeTabId, loadPage, setSplitTabIds, setTabs]);
    const handleOpenTableParallel = useCallback((tableId: string) => {
        if (!activeTabId) {
            const fallbackTabId = tabs[tabs.length - 1]?.id || null;
            if (!fallbackTabId) {
                toast.error(t('errors.open_parallel_first'));
                return;
            }
            setActiveTabId(fallbackTabId);
            setViewMode('editor');
        }
        setSplitTableIds(prev => {
            if (prev.includes(tableId))
                return prev;
            if (splitTabIds.length + prev.length + 1 >= MAX_PANES)
                return prev;
            return [...prev, tableId];
        });
    }, [activeTabId, setSplitTableIds, tabs, setActiveTabId, setViewMode, t, splitTabIds.length]);
    const handleTabSelect = (tabId: string) => {
        const tab = tabs.find(t => t.id === tabId);
        if (!tab)
            return;
        if (tab.isDrawing) {
            pushToHistory({ type: 'drawing', id: tabId });
        }
        else if (tab.isTable) {
            const tableId = getTableIdFromTab(tab);
            if (tableId) {
                pushToHistory({ type: 'table', id: tableId });
            }
        }
        else if (!tab.isPdf) {
            // PDF tabs don't go into the navigation history (they have no canonical route
            // within the Vault) — they're session-only. Reacts to opening them
            // again with the same link.
            pushToHistory({
                type: 'editor',
                id: tabId,
                resourceType: knowledgeDocumentType(tab),
            });
        }
        setActiveTabId(tabId);
        if (tab.isDrawing) {
            setViewMode('drawing');
            setActiveTableId(null);
            return;
        }
        setViewMode('editor');
        if (tab.isTable) {
            setActiveTableId(getTableIdFromTab(tab));
            return;
        }
        setActiveTableId(null);
    };
    return { handleTabClose, handleToggleSplit, handleOpenParallel, handleOpenInCurrentTab, handleOpenTableParallel, handleTabSelect };
}
