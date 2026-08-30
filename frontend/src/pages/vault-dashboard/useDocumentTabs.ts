import { useCallback } from 'react';
import { toast } from '../../lib/toast';
import { knowledgeDocumentType } from '../../lib/vaultRouting';
import { getTableIdFromTab } from './tab-model';
import type { DashboardState } from './useDashboardState';
import type { useNavigationHistory } from './useNavigationHistory';
import type { usePageLoading } from './usePageLoading';
import type { useTableNavigation } from './useTableNavigation';
type Context = Pick<DashboardState, 'activeTabId' | 'setActiveTabId' | 'setActiveTableId' | 'setSplitTabIds' | 'setSplitTableIds' | 'setTabs' | 'setViewMode' | 'splitTabIds' | 'splitTableIds' | 't' | 'tabs'> & Pick<ReturnType<typeof useNavigationHistory>, 'pushToHistory'> & Pick<ReturnType<typeof usePageLoading>, 'ensurePageTabLoaded' | 'loadPage'> & Pick<ReturnType<typeof useTableNavigation>, 'handleTableSelect'>;
export function useDocumentTabs(context: Context) {
    const { activeTabId, ensurePageTabLoaded, handleTableSelect, loadPage, pushToHistory, setActiveTabId, setActiveTableId, setSplitTabIds, setSplitTableIds, setTabs, setViewMode, splitTabIds, splitTableIds, t, tabs } = context;
    const MAX_PANES = 4;
    const handleTabClose = useCallback((tabId: string) => {
        setTabs(prevTabs => {
            const closingTab = prevTabs.find(t => t.id === tabId);
            const remainingTabs = prevTabs.filter(t => t.id !== tabId);
            setSplitTabIds(prevSplit => {
                const remainingSplitTabIds = prevSplit.filter(id => id !== tabId);
                if (activeTabId === tabId) {
                    // If we close a document (PDF/EPUB) that remembers where it was
                    // opened from, we return there instead of the generic "last
                    // tab" fallback — it's the "go back" the user expected.
                    const origin = closingTab?.origin;
                    if (origin && (origin.tableId || origin.tabId)) {
                        if (origin.tabId && remainingTabs.some(tab => tab.id === origin.tabId)) {
                            const ot = remainingTabs.find(tab => tab.id === origin.tabId);
                            setActiveTabId(origin.tabId);
                            setActiveTableId(ot?.isTable ? getTableIdFromTab(ot) : null);
                            setViewMode(ot?.isDrawing ? 'drawing' : 'editor');
                            return remainingSplitTabIds.filter(id => id !== origin.tabId);
                        }
                        if (origin.tableId) {
                            // handleTableSelect fixa activeTableId/viewMode i
                            // sets activeTabId=null by itself. fromHistory=true:
                            // going back should not add a new entry to
                            // the history (the URL is already that of the origin table).
                            void handleTableSelect(origin.tableId, origin.viewId || null, true);
                            // We go to the inline table view, which does NOT render
                            // split panels: we clear splitTabIds so as not to
                            // leaving them orphaned (invisible until you go back to
                            // an editor).
                            return [];
                        }
                    }
                    const promotedPaneId = remainingSplitTabIds.find(id => remainingTabs.some(tab => tab.id === id)) || null;
                    const fallbackTabId = remainingTabs[remainingTabs.length - 1]?.id || null;
                    const nextActiveTabId = promotedPaneId || fallbackTabId;
                    if (nextActiveTabId) {
                        const nextTab = remainingTabs.find(tab => tab.id === nextActiveTabId);
                        setActiveTabId(nextActiveTabId);
                        setActiveTableId(nextTab?.isTable ? getTableIdFromTab(nextTab) : null);
                        setViewMode(nextTab?.isDrawing ? 'drawing' : 'editor');
                        return remainingSplitTabIds.filter(id => id !== nextActiveTabId);
                    }
                    else if (splitTableIds[0]) {
                        const promotedTableId = splitTableIds[0];
                        setSplitTableIds(prev => prev.filter(id => id !== promotedTableId));
                        void handleTableSelect(promotedTableId);
                        return remainingSplitTabIds;
                    }
                    else {
                        setActiveTabId(null);
                        return remainingSplitTabIds;
                    }
                }
                return remainingSplitTabIds;
            });
            return remainingTabs;
        });
    }, [setTabs, setSplitTabIds, activeTabId, splitTableIds, setActiveTabId, setActiveTableId, setViewMode, handleTableSelect, setSplitTableIds]);
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
