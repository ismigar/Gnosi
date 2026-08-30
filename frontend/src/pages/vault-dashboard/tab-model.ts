import type { Tab } from './types';
const TABLE_TAB_PREFIX = 'table:';
export const MAX_PANES = 4;
export function buildTableTabId(tableId: string): string {
    return `${TABLE_TAB_PREFIX}${tableId}`;
}
export function getTableIdFromTab(tab: Partial<Tab> | null | undefined): string | null {
    if (!tab?.isTable)
        return null;
    if (tab.tableId)
        return tab.tableId;
    if (tab.id?.startsWith(TABLE_TAB_PREFIX))
        return tab.id.slice(TABLE_TAB_PREFIX.length);
    return tab.id || null;
}
export function shiftDay(iso: unknown, delta: number): string | null {
    if (typeof iso !== 'string')
        return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match)
        return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    date.setDate(date.getDate() + delta);
    return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function reorderTabs(tabs: readonly Tab[], reordered: readonly {
    id: string;
}[]): Tab[] {
    // The tab strip owns order, not document metadata, PDF origins, or loaded content.
    const byId = new Map(tabs.map(tab => [tab.id, tab]));
    return reordered.flatMap(tab => {
        const existing = byId.get(tab.id);
        return existing ? [existing] : [];
    });
}
