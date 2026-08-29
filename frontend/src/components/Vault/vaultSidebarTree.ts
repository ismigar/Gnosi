import { isAppContent, isCalendarPage } from './schemaUtils';

interface SidebarMetadata {
    database_table_id?: string | null;
    is_dashboard?: boolean;
    is_template?: boolean;
    table_id?: string | null;
    [key: string]: unknown;
}

interface SidebarPage {
    folder?: string | null;
    id: string;
    is_database?: boolean;
    metadata?: SidebarMetadata;
    parent_id?: string | null;
    resolved_table_id?: string | null;
    title?: string;
    [key: string]: unknown;
}

type SidebarSection =
    | { kind: 'dashboard' }
    | { kind: 'data'; tableId: string | null }
    | { kind: 'wiki' };

interface DataTree<Page extends SidebarPage> {
    children: Record<string, Page[]>;
    roots: Page[];
}

interface VaultSidebarTrees<Page extends SidebarPage> {
    childrenMap: Record<string, Page[]>;
    dashboardChildrenMap: Record<string, Page[]>;
    dashboardRootPages: Page[];
    dataChildrenMap: Record<string, DataTree<Page>>;
    rootPages: Page[];
}

function stringifySidebarValue(value: unknown): string {
    return Reflect.apply(String, undefined, [value]);
}

/**
 * Builds the page trees used by the Vault sidebar.
 *
 * Storage membership and visual placement are intentionally different: a Wiki
 * file below a database row stays a Wiki file, while its sidebar node is placed
 * below that row in the Data tree.
 */
export const buildVaultSidebarTrees = <Page extends SidebarPage>(
    pages: readonly Page[] = [],
): VaultSidebarTrees<Page> => {
    const childrenMap: Record<string, Page[]> = {};
    const rootPages: Page[] = [];
    const dataChildrenMap: Record<string, DataTree<Page>> = {};
    const dashboardChildrenMap: Record<string, Page[]> = {};
    const dashboardRootPages: Page[] = [];

    const dataTreeFor = (tableId: string): DataTree<Page> => {
        const tableTree = dataChildrenMap[tableId] ?? {
            roots: [],
            children: {},
        };
        dataChildrenMap[tableId] = tableTree;
        return tableTree;
    };

    const pagesById: Record<string, Page> = {};
    pages.forEach((page) => { pagesById[page.id] = page; });

    const isDashboardPage = (page: Page | undefined): boolean => {
        if (!page) return false;
        const folder = stringifySidebarValue(page.folder || '');
        return page.metadata?.is_dashboard === true
            || folder === 'Dashboard'
            || folder.startsWith('Dashboard/')
            || folder === '.Dashboards'
            || folder.startsWith('.Dashboards/');
    };

    const ownTableId = (page: Page): string | null | undefined =>
        page.resolved_table_id || page.metadata?.table_id || page.metadata?.database_table_id;
    const hasOwnDataMarkers = (page: Page): boolean => {
        const tableId = ownTableId(page);
        return page.is_database || (!!tableId && tableId !== 'wiki') || page.folder?.startsWith('BD/');
    };

    // This resolves sidebar placement, not storage membership. Wiki descendants
    // inherit a database parent's Data placement so the complete hierarchy is
    // rendered below the row. Their own metadata remains unchanged.
    const sectionCache: Record<string, SidebarSection> = {};
    const sectionOf = (
        page: Page | undefined,
        visiting?: Set<string>,
    ): SidebarSection => {
        if (!page) return { kind: 'wiki' };
        const cached = sectionCache[page.id];
        if (cached) return cached;
        const seen = visiting || new Set<string>();
        if (seen.has(page.id)) return { kind: 'wiki' };
        seen.add(page.id);

        let section: SidebarSection;
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

        const parentId = page.parent_id;
        const parent = parentId ? pagesById[parentId] : undefined;
        const section = sectionOf(page);

        if (section.kind === 'dashboard') {
            if (parentId && parent && sectionOf(parent).kind === 'dashboard') {
                const siblings = dashboardChildrenMap[parentId] ?? [];
                siblings.push(page);
                dashboardChildrenMap[parentId] = siblings;
            } else {
                dashboardRootPages.push(page);
            }
            return;
        }

        if (section.kind === 'data') {
            if (!section.tableId) return;
            const parentSection = parent ? sectionOf(parent) : null;
            if (parentId && parentSection?.kind === 'data'
                && parentSection.tableId === section.tableId) {
                const tableTree = dataTreeFor(section.tableId);
                const siblings = tableTree.children[parentId] ?? [];
                siblings.push(page);
                tableTree.children[parentId] = siblings;
            } else if (hasOwnDataMarkers(page)) {
                dataTreeFor(section.tableId).roots.push(page);
            } else {
                // A Wiki page whose database parent disappeared remains visible.
                rootPages.push(page);
            }
            return;
        }

        if (parentId && parent && sectionOf(parent).kind === 'wiki') {
            const siblings = childrenMap[parentId] ?? [];
            siblings.push(page);
            childrenMap[parentId] = siblings;
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
