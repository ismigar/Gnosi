import { sortKey } from '../../../../shared/filtering/vaultFilters';
import type { FavoritesSort, PageChildren, SidebarPage, SidebarTable, SidebarView } from './types';
export const compareFavoriteTitles = (aTitle: string, bTitle: string, direction: 'asc' | 'desc') => {
    const a = aTitle.trim();
    const b = bTitle.trim();
    const aPriority = /^[\d_]/u.test(a);
    const bPriority = /^[\d_]/u.test(b);

    if (aPriority !== bPriority) {
        const priorityFirst = direction === 'asc';
        return aPriority === priorityFirst ? -1 : 1;
    }

    const comparison = sortKey(a).localeCompare(sortKey(b), 'en', { sensitivity: 'base' });
    return direction === 'asc' ? comparison : -comparison;
};
export function sortFavorites(favoritePages: readonly SidebarPage[], favoritesSort: FavoritesSort): SidebarPage[] {
    const list = [...favoritePages];
    const { mode, manualOrder } = favoritesSort;
    if (mode === 'alpha-asc') {
        return list.sort((a, b) => compareFavoriteTitles(a.title, b.title, 'asc'));
    }
    if (mode === 'alpha-desc') {
        return list.sort((a, b) => compareFavoriteTitles(a.title, b.title, 'desc'));
    }
    if (mode === 'recent') {
        return list.sort((a, b) => (b.last_modified || '').localeCompare((a.last_modified || '')));
    }
    if (mode === 'oldest') {
        return list.sort((a, b) => (a.last_modified || '').localeCompare((b.last_modified || '')));
    }
    // mode === 'manual': respect explicit order, then add new favorites at the end
    const order = manualOrder;
    const orderedIds = new Set(order);
    const byId = new Map(list.map((p) => [p.id, p]));
    const ordered = order.map((id) => byId.get(id)).filter((page): page is SidebarPage => page !== undefined);
    const newcomers = list.filter((p) => !orderedIds.has(p.id));
    return [...ordered, ...newcomers];
}
export function groupTables(tables: readonly SidebarTable[]): Record<string, SidebarTable[]> {
    const mapping: Record<string, SidebarTable[]> = {};
    tables.forEach((table) => {
        const dbId = table.database_id;
        if (!mapping[dbId]) mapping[dbId] = [];
        mapping[dbId].push(table);
    });
    return mapping;
}
export function groupViews(views: readonly SidebarView[]): Record<string, SidebarView[]> {
    const mapping: Record<string, SidebarView[]> = {};
    views.forEach((view) => {
        // A view belongs to its base table AND to every table it joins
        // (multi-table views). This way the view appears in the list of
        // each involved table, matching the backend's `/views?table_id=`.
        const ids = new Set([
            view.table_id,
            ...((view.joins || [])
                .map(j => j && j.tableId).filter((id): id is string => Boolean(id))),
        ].filter((id): id is string => Boolean(id)));
        ids.forEach(tableId => {
            if (!mapping[tableId]) mapping[tableId] = [];
            mapping[tableId].push(view);
        });
    });
    return mapping;
}
export function allowsSubitems(viewsByTable: Record<string, SidebarView[]>): Record<string, boolean> {
    const mapping: Record<string, boolean> = {};
    Object.entries(viewsByTable).forEach(([tableId, tableViews]) => {
        const normalizedViews = tableViews;
        const mainTableView = normalizedViews.find((v) => (v.type || 'table') === 'table') || normalizedViews[0];
        mapping[tableId] = Boolean(mainTableView?.enableSubitems);
    });
    return mapping;
}
export function decodePageMove(raw: string): string | undefined {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || !('id' in value)) return undefined;
    return typeof value.id === 'string' ? value.id : undefined;
}
/** Retain the existing descendant traversal used by the HTML5 move protocol. */
export function blocksMove(sourceId: string, targetId: string, childrenMap: PageChildren): boolean {
    const queue = [targetId];
    const seen = new Set<string>();
    while (queue.length) {
        const current = queue.shift();
        if (current === undefined || seen.has(current)) continue;
        seen.add(current);
        if (current === sourceId) return true;
        for (const child of childrenMap[current] || []) queue.push(child.id);
    }
    return false;
}
