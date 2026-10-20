import { useEffect, useLayoutEffect, useRef } from 'react';
import { fetchVaultPage } from '../../../shared/api/vaults';
import { fetchDrawing } from '../../../shared/api/drawings';
import { useRequestContext } from '../../../shared/hooks/useRequestContext';
import { currentRequestContext, type RequestContext } from '../../../shared/api/request-context';
import { getActiveVaultId } from '../../../shared/api/vault-context';
import { toast } from '../../../shared/notifications/toast';
import type { SavedWorkspace } from '../navigation/workspacesModel';
import type { DashboardController } from './useDashboardController';
import type { Tab } from './types';
import { getTableIdFromTab } from './tab-model';

function requestScopeKey(scope: RequestContext): string {
    return JSON.stringify([scope.userId, scope.userEmail, scope.vaultId, scope.workspaceId]);
}

/** Stage remote reads before changing the layout; keep already-open editor drafts. */
export function useSavedWorkspaces(context: DashboardController) {
    const latest = useRef(context);
    useLayoutEffect(() => { latest.current = context; }, [context]);
    const request = useRef(0);
    const pending = useRef<{ controller: AbortController; navigation: string; scope: string } | null>(null);
    const observedScope = useRequestContext();
    const scopeKey = requestScopeKey({ ...observedScope, vaultId: getActiveVaultId() });
    const navigation = JSON.stringify([context.activeTabId, context.activeTableId, context.activeViewId, context.viewMode, context.nestedPath]);
    useLayoutEffect(() => {
        if (pending.current && (pending.current.scope !== scopeKey || pending.current.navigation !== navigation)) {
            pending.current.controller.abort();
            pending.current = null;
            request.current++;
        }
    }, [navigation, scopeKey]);
    useEffect(() => {
        const state = pending;
        return () => { state.current?.controller.abort(); };
    }, []);
    const restoreWorkspace = async (workspace: SavedWorkspace) => {
        pending.current?.controller.abort();
        const sequence = ++request.current;
        const vaultId = getActiveVaultId();
        if (workspace.vaultId !== vaultId) return;
        const capturedScope = { ...currentRequestContext(), vaultId };
        const capturedKey = requestScopeKey(capturedScope);
        const controller = new AbortController();
        pending.current = { controller, scope: capturedKey, navigation };
        const isCurrent = () => !controller.signal.aborted && sequence === request.current
            && requestScopeKey({ ...currentRequestContext(), vaultId: getActiveVaultId() }) === capturedKey;
        try {
            const loaded = await Promise.all(workspace.tabs.map(async (saved): Promise<Tab> => {
                const existing = latest.current.tabs.find(tab => tab.id === saved.id);
                if (saved.type === 'document') return { ...existing, ...saved, isPdf: true, isDrawing: false, isTable: false,
                    src: saved.src ?? '', kind: saved.kind ?? 'pdf', location: saved.location ?? null, origin: saved.origin };
                if (existing) return existing;
                if (saved.type === 'page') {
                    const page = await fetchVaultPage(saved.id, controller.signal, capturedScope);
                    return { ...page, id: saved.id, title: typeof page.title === 'string' ? page.title : saved.title };
                }
                if (saved.type === 'drawing') await fetchDrawing(saved.id, controller.signal, capturedScope);
                if (saved.type === 'table' && !latest.current.registry.tables.some(table => table.id === saved.tableId)) throw new Error('Workspace table no longer exists');
                return { ...saved };
            }));
            if (!isCurrent()) return;
            const d = latest.current;
            const { layout } = workspace;
            if ([...layout.splitTableIds, ...(layout.activeTableId ? [layout.activeTableId] : [])]
                .some(id => !d.registry.tables.some(table => table.id === id))) throw new Error('Workspace table no longer exists');
            const byId = new Map(loaded.map(tab => [tab.id, tab]));
            const active = byId.get(layout.activeTabId ?? '') ?? loaded[0];
            const activeId = layout.activeTabId === null ? null : active?.id ?? null;
            const splitTabIds = layout.splitTabIds.filter(id => id !== activeId && byId.has(id));
            const activeTableId = activeId && active?.isTable ? getTableIdFromTab(active) : layout.activeTableId;
            const splitTableIds = layout.splitTableIds.filter(id => id !== activeTableId);
            const paneCount = (activeId ? 1 : 0) + splitTabIds.length + splitTableIds.length;
            pending.current = null;
            // Preserve editable documents; restore the saved reader descriptor even when its tab is already open.
            d.setTabs(previous => [
                ...loaded.map(tab => {
                    const current = previous.find(candidate => candidate.id === tab.id);
                    return tab.isPdf ? { ...current, ...tab } : current ?? tab;
                }),
                ...previous.filter(tab => !byId.has(tab.id)),
            ]);
            d.setActiveTabId(activeId);
            d.setActiveTableId(activeTableId);
            d.setActiveViewId(layout.activeViewId);
            d.setViewMode(layout.viewMode);
            d.setSplitTabIds(splitTabIds);
            d.setSplitTableIds(splitTableIds);
            const total = layout.paneSizes.reduce((sum, size) => sum + size, 0);
            d.setPaneSizes(layout.paneSizes.length === paneCount && total > 0
                ? layout.paneSizes.map(size => size / total * 100)
                : Array.from({ length: paneCount }, () => 100 / paneCount));
            if (activeTableId) {
                d.setSchema(d.getSchemaFromTableId(activeTableId));
                d.setViews(d.registry.views.filter(view => view.table_id === activeTableId));
                void d.fetchPagesByTable(activeTableId);
            }
        } catch {
            if (isCurrent()) {
                toast.error(latest.current.t('doc_tabs.workspace_restore_error', 'The workspace could not be restored. A document may be unavailable. Your open tabs are kept.'));
            }
        } finally {
            if (pending.current?.controller === controller) pending.current = null;
        }
    };
    return { restoreWorkspace };
}
