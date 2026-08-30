import type { DashboardActions } from './useDashboardActions';
import type { Breadcrumb, HistoryOrigin, Page } from './types';
export function useBreadcrumbs(context: DashboardActions) {
    const { activeTabId, historyPointer, loadPage, navigationHistory, pages, registry, resolvePageTableId, returnToTableFromBreadcrumb, setActiveTabId, setViewMode, t, } = context;
    const favoritePages = pages.filter(p => (p.metadata?.favorite === true || p.metadata?.favorite === 'true') && !p.metadata.is_template);
    // Recursive method to build breadcrumbs for parent->child hierarchy
    const buildPageParentBreadcrumbs = (pageId: string, currentTrail: Breadcrumb[] = []): Breadcrumb[] => {
        const page = pages.find(p => p.id === pageId);
        if (!page)
            return currentTrail;
        const newTrail = [{ label: page.title, onClick: () => loadPage(page.id) }, ...currentTrail];
        if (page.parent_id) {
            return buildPageParentBreadcrumbs(page.parent_id, newTrail);
        }
        return newTrail;
    };
    const buildTableCrumbsByTableId = (tableId: string, viewId: string | null = null) => {
        const table = registry.tables.find(t => t.id === tableId);
        if (!table)
            return [];
        const crumbs = [];
        const database = registry.databases.find(db => db.id === table.database_id);
        if (database) {
            crumbs.push({
                label: database.name,
                onClick: () => { returnToTableFromBreadcrumb(table.id, viewId); }
            });
        }
        crumbs.push({
            label: table.name,
            onClick: () => { returnToTableFromBreadcrumb(table.id, viewId); }
        });
        return crumbs;
    };
    const buildTableContextBreadcrumbs = (page: Page | null | undefined) => {
        if (!page)
            return [];
        const tableId = resolvePageTableId(page);
        if (!tableId)
            return [];
        return buildTableCrumbsByTableId(tableId);
    };
    // Builds the "container" segment of an entry's breadcrumb according to
    // the actual navigation ORIGIN (where the user opened it from), not just the
    // structural hierarchy of the table. Case tree:
    //   - origin = dashboard   -> segment toward the dashboard (returns there on click)
    //   - source = table view  -> DB / Table segment (at the exact view)
    //   - other / unknown   -> null (the caller falls back to the structural hierarchy)
    const buildOriginContainerCrumbs = (origin: HistoryOrigin | null | undefined) => {
        if (!origin)
            return null;
        if (origin.type === 'table') {
            const safeViewId = origin.subId && registry.views.some(v => v.id === origin.subId)
                ? origin.subId
                : null;
            return buildTableCrumbsByTableId(origin.id, safeViewId);
        }
        if (origin.type === 'editor') {
            const originPage = pages.find(p => p.id === origin.id);
            if (!originPage)
                return null;
            const originIsDashboard = originPage.metadata?.is_dashboard === true
                || originPage.metadata?.is_dashboard === 'true';
            if (originIsDashboard) {
                return buildPageParentBreadcrumbs(origin.id);
            }
        }
        return null;
    };
    const breadcrumbs = [
        { label: t('common.knowledge'), onClick: () => { setActiveTabId(null); setViewMode('editor'); } }
    ];
    if (activeTabId) {
        const activePage = pages.find(p => p.id === activeTabId);
        const pageBreadcrumbs = buildPageParentBreadcrumbs(activeTabId);
        const hasParentHierarchy = pageBreadcrumbs.length > 1;
        if (!hasParentHierarchy) {
            // For a table record, prioritize the actual navigation origin
            // (dashboard or table view) and, if we don't have one, fall back to the
            // structural hierarchy of the table the record belongs to.
            let containerCrumbs = null;
            if (resolvePageTableId(activePage)) {
                const currentHistoryEntry = navigationHistory[historyPointer];
                const origin = (currentHistoryEntry && currentHistoryEntry.id === activeTabId)
                    ? currentHistoryEntry.from
                    : null;
                containerCrumbs = buildOriginContainerCrumbs(origin);
            }
            breadcrumbs.push(...(containerCrumbs ?? buildTableContextBreadcrumbs(activePage)));
        }
        breadcrumbs.push(...pageBreadcrumbs);
    }
    return { breadcrumbs, favoritePages };
}
