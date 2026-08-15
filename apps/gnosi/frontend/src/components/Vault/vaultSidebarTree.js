import { isAppContent, isCalendarPage } from './schemaUtils';

/**
 * Builds the page trees used by the Vault sidebar.
 *
 * Storage membership and visual placement are intentionally different: a Wiki
 * file below a database row stays a Wiki file, while its sidebar node is placed
 * below that row in the Data tree.
 */
export const buildVaultSidebarTrees = (pages = []) => {
    const childrenMap = {};
    const rootPages = [];
    const dataChildrenMap = {};
    const dashboardChildrenMap = {};
    const dashboardRootPages = [];

    const pagesById = {};
    pages.forEach((page) => { pagesById[page.id] = page; });

    const isDashboardPage = (page) => {
        if (!page) return false;
        const folder = String(page.folder || '');
        return page.metadata?.is_dashboard === true
            || folder === 'Dashboard'
            || folder.startsWith('Dashboard/')
            || folder === '.Dashboards'
            || folder.startsWith('.Dashboards/');
    };

    const ownTableId = (page) =>
        page.resolved_table_id || page.metadata?.table_id || page.metadata?.database_table_id;
    const hasOwnDataMarkers = (page) => {
        const tableId = ownTableId(page);
        return page.is_database || (!!tableId && tableId !== 'wiki') || page.folder?.startsWith('BD/');
    };

    // This resolves sidebar placement, not storage membership. Wiki descendants
    // inherit a database parent's Data placement so the complete hierarchy is
    // rendered below the row. Their own metadata remains unchanged.
    const sectionCache = {};
    const sectionOf = (page, visiting) => {
        if (!page) return { kind: 'wiki' };
        const cached = sectionCache[page.id];
        if (cached) return cached;
        const seen = visiting || new Set();
        if (seen.has(page.id)) return { kind: 'wiki' };
        seen.add(page.id);

        let section;
        if (isDashboardPage(page)) {
            section = { kind: 'dashboard' };
        } else if (hasOwnDataMarkers(page)) {
            let tableId = ownTableId(page);
            if (!tableId && page.parent_id && pagesById[page.parent_id]) {
                const parentSection = sectionOf(pagesById[page.parent_id], seen);
                if (parentSection.kind === 'data') tableId = parentSection.tableId;
            }
            section = { kind: 'data', tableId: tableId || null };
        } else if (page.parent_id && pagesById[page.parent_id]) {
            section = sectionOf(pagesById[page.parent_id], seen);
        } else {
            section = { kind: 'wiki' };
        }
        sectionCache[page.id] = section;
        return section;
    };

    pages.forEach((page) => {
        // BD rows are app content but must still enter the Data tree. Other app
        // content such as Mail, Assets, and Calendar stays outside the sidebar.
        if (page.metadata?.is_template
            || isCalendarPage(page)
            || (isAppContent(page) && !hasOwnDataMarkers(page))) return;

        const parent = page.parent_id ? pagesById[page.parent_id] : null;
        const section = sectionOf(page);

        if (section.kind === 'dashboard') {
            if (parent && sectionOf(parent).kind === 'dashboard') {
                if (!dashboardChildrenMap[page.parent_id]) dashboardChildrenMap[page.parent_id] = [];
                dashboardChildrenMap[page.parent_id].push(page);
            } else {
                dashboardRootPages.push(page);
            }
            return;
        }

        if (section.kind === 'data') {
            if (!section.tableId) return;
            const parentSection = parent ? sectionOf(parent) : null;
            if (parentSection?.kind === 'data' && parentSection.tableId === section.tableId) {
                if (!dataChildrenMap[section.tableId]) {
                    dataChildrenMap[section.tableId] = { roots: [], children: {} };
                }
                const tableTree = dataChildrenMap[section.tableId];
                if (!tableTree.children[page.parent_id]) tableTree.children[page.parent_id] = [];
                tableTree.children[page.parent_id].push(page);
            } else if (hasOwnDataMarkers(page)) {
                if (!dataChildrenMap[section.tableId]) {
                    dataChildrenMap[section.tableId] = { roots: [], children: {} };
                }
                dataChildrenMap[section.tableId].roots.push(page);
            } else {
                // A Wiki page whose database parent disappeared remains visible.
                rootPages.push(page);
            }
            return;
        }

        if (parent && sectionOf(parent).kind === 'wiki') {
            if (!childrenMap[page.parent_id]) childrenMap[page.parent_id] = [];
            childrenMap[page.parent_id].push(page);
        } else {
            rootPages.push(page);
        }
    });

    return {
        childrenMap,
        rootPages,
        dataChildrenMap,
        dashboardChildrenMap,
        dashboardRootPages,
    };
};
