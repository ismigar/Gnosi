import { useEffect } from 'react';
import { vaultAgentContextRefs } from '../../lib/vaultAgentContext';
import { vaultPageViewIds } from '../../lib/vaultAgentContext';
import { getTableIdFromTab } from './tab-model';
import { emitAppEvent } from '../../shared/platform/app-events';
import type { DashboardActions } from './useDashboardActions';
export function useAgentContext(context: DashboardActions) {
    const { activeTabId, activeTableId, activeViewId, pages, registry, resolvePageTableId, tabs, viewMode, } = context;
    const activeContextTab = activeTabId
        ? tabs.find(tab => tab.id === activeTabId) || null
        : null;
    const activeContextTabTableId = getTableIdFromTab(activeContextTab);
    const activeContextEmbeddedViewIds = vaultPageViewIds(activeContextTab);
    const activeContextEmbeddedView = activeContextEmbeddedViewIds.length === 1
        ? registry.views.find(view => view.id === activeContextEmbeddedViewIds[0]) || null
        : null;
    const activeContextPage = activeTabId
        && !activeContextTabTableId
        && !activeContextEmbeddedView
        ? activeContextTab || pages.find(page => page.id === activeTabId) || null
        : null;
    const activeContextTableId = activeContextTabTableId
        || activeContextEmbeddedView?.table_id
        || (viewMode === 'table' ? activeTableId : resolvePageTableId(activeContextPage));
    const activeContextTable = registry.tables.find(table => table.id === activeContextTableId) || null;
    const activeContextView = activeContextEmbeddedView || (activeContextTableId
        ? registry.views.find(view => view.id === activeViewId && view.table_id === activeContextTableId) || null
        : null);
    useEffect(() => {
        emitAppEvent('gnosi:module-context', vaultAgentContextRefs({
            page: activeContextPage,
            table: activeContextTable,
            view: activeContextView,
        }));
    }, [activeContextPage, activeContextTable, activeContextView]);
}
