import type { DocumentLocationEventDetail } from '../../../shared/platform/app-events';
import type { Tab, ViewMode } from '../dashboard/types';
import { getTableIdFromTab, MAX_PANES } from '../dashboard/tab-model';

export interface WorkspaceTab {
    readonly id: string;
    readonly title?: string | null;
    readonly isTable?: boolean;
    readonly isDrawing?: boolean;
    readonly isPdf?: boolean;
    readonly tableId?: string;
    readonly src?: string;
    readonly kind?: 'pdf' | 'epub' | 'snapshot';
    readonly location?: DocumentLocationEventDetail | null;
    readonly origin?: Tab['origin'];
}
export interface SavedWorkspaceTab extends WorkspaceTab {
    readonly title: string;
    readonly type: 'page' | 'table' | 'drawing' | 'document';
}
export interface WorkspaceLayout {
    readonly activeTabId: string | null;
    readonly activeTableId: string | null;
    readonly activeViewId: string | null;
    readonly viewMode: ViewMode;
    readonly splitTabIds: readonly string[];
    readonly splitTableIds: readonly string[];
    readonly paneSizes: readonly number[];
}
export interface SavedWorkspace {
    readonly version: 2;
    readonly id: string;
    readonly name: string;
    readonly vaultId: string | null;
    readonly tabs: readonly SavedWorkspaceTab[];
    readonly layout: WorkspaceLayout;
}
const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const optionalString = (value: unknown): value is string | null | undefined =>
    value == null || typeof value === 'string';
const stringList = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every(item => typeof item === 'string');

export function saveWorkspaceTab(tab: WorkspaceTab, untitled: string): SavedWorkspaceTab {
    const base = { id: tab.id, title: tab.title || untitled };
    if (tab.isPdf) return { ...base, type: 'document', isPdf: true, src: tab.src ?? '', kind: tab.kind ?? 'pdf', location: tab.location ?? null, ...(tab.origin ? { origin: tab.origin } : {}) };
    if (tab.isDrawing) return { ...base, type: 'drawing', isDrawing: true };
    if (tab.isTable) return { ...base, type: 'table', isTable: true, tableId: getTableIdFromTab({ id: tab.id, isTable: true, tableId: tab.tableId }) ?? tab.id };
    return { ...base, type: 'page' };
}
export function defaultWorkspaceLayout(tabs: readonly SavedWorkspaceTab[]): WorkspaceLayout {
    const first = tabs[0];
    return { activeTabId: first?.id ?? null, activeTableId: first?.tableId ?? null, activeViewId: null, viewMode: first?.type === 'drawing' ? 'drawing' : 'editor', splitTabIds: [], splitTableIds: [], paneSizes: first ? [100] : [] };
}
function readTab(value: unknown, legacy: boolean): SavedWorkspaceTab | null {
    if (!record(value) || typeof value.id !== 'string' || !value.id || typeof value.title !== 'string') return null;
    if (legacy) return typeof value.isTable === 'boolean' ? saveWorkspaceTab(value as unknown as WorkspaceTab, '') : null;
    if (value.type === 'page') return { id: value.id, title: value.title, type: 'page' };
    if (value.type === 'drawing') return { id: value.id, title: value.title, type: 'drawing', isDrawing: true };
    if (value.type === 'table' && typeof value.tableId === 'string') return { id: value.id, title: value.title, type: 'table', isTable: true, tableId: value.tableId };
    if (value.type !== 'document' || typeof value.src !== 'string' || !['pdf', 'epub', 'snapshot'].includes(String(value.kind))) return null;
    if (value.location != null && !record(value.location)) return null;
    if (value.origin != null && (!record(value.origin) || !optionalString(value.origin.tabId) || !optionalString(value.origin.tableId) || !optionalString(value.origin.viewId))) return null;
    return { id: value.id, title: value.title, type: 'document', isPdf: true, src: value.src, kind: value.kind as Tab['kind'], location: value.location as DocumentLocationEventDetail | null, ...(record(value.origin) ? { origin: { tabId: typeof value.origin.tabId === 'string' ? value.origin.tabId : null, tableId: typeof value.origin.tableId === 'string' ? value.origin.tableId : null, viewId: typeof value.origin.viewId === 'string' ? value.origin.viewId : null } } : {}) };
}
function readLayout(value: unknown): WorkspaceLayout | null {
    if (!record(value) || !optionalString(value.activeTabId) || !optionalString(value.activeTableId) || !optionalString(value.activeViewId)
        || !['editor', 'table', 'drawing', 'trash', 'tags'].includes(String(value.viewMode))
        || !stringList(value.splitTabIds) || !stringList(value.splitTableIds)
        || !Array.isArray(value.paneSizes) || !value.paneSizes.every(size => typeof size === 'number' && Number.isFinite(size) && size > 0)
        || value.splitTabIds.length + value.splitTableIds.length >= MAX_PANES || value.paneSizes.length > MAX_PANES) return null;
    return { activeTabId: value.activeTabId ?? null, activeTableId: value.activeTableId ?? null, activeViewId: value.activeViewId ?? null, viewMode: value.viewMode as ViewMode, splitTabIds: value.splitTabIds, splitTableIds: value.splitTableIds, paneSizes: value.paneSizes as number[] };
}

/** Migrate v1 entries independently so a malformed sibling cannot erase all layouts. */
export function readWorkspaces(value: unknown, currentVaultId: string | null): SavedWorkspace[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item: unknown) => {
        if (!record(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || !Array.isArray(item.tabs)) return [];
        if (item.version !== undefined && item.version !== 2) return [];
        const legacy = item.version === undefined;
        const tabs = item.tabs.map(tab => readTab(tab, legacy));
        if (tabs.some(tab => !tab) || new Set(tabs.map(tab => tab?.id)).size !== tabs.length) return [];
        const validTabs = tabs as SavedWorkspaceTab[];
        const layout = legacy ? defaultWorkspaceLayout(validTabs) : readLayout(item.layout);
        if (!layout || (!legacy && !optionalString(item.vaultId))) return [];
        return [{ version: 2 as const, id: item.id, name: item.name, vaultId: legacy ? currentVaultId : (typeof item.vaultId === 'string' ? item.vaultId : null), tabs: validTabs, layout }];
    });
}
