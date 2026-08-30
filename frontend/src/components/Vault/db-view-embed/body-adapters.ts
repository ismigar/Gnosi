import { applyVaultTemplate, deleteVaultPage, apiErrorStatus, patchSectionConfig, patchPageMetadata, updateVaultView } from './api';
import { emitAppEvent } from './events';
import { decodeView, isRecord, metadata } from './decode';
import { reportEmbedError } from './diagnostics';
import type { EmbedInputs } from './inputs';
import type { EmbedDerived } from './useEmbedDerived';
import type { EmbedRecordActions } from './useEmbedRecordActions';
import type { EmbedTabActions } from './useEmbedTabActions';
import type { Column } from './types';
import type { VaultViewPage } from '../../../hooks/useVaultViewData';
function decodeViewUpdate(value: unknown) {
    const source = isRecord(value) ? value : {};
    const view = decodeView(source);
    const sort = Array.isArray(source.sort) ? decodeView({ sorts: source.sort }).sorts : view.sort;
    return { ...view, sort, visibleProperties: Array.isArray(source.visibleProperties) ? source.visibleProperties.filter((key: unknown): key is string => typeof key === 'string') : undefined };
}
export function createBodyAdapters({ ctx, table, handleOpenConfig, templates, handleCreate, reload, pageId, view, activeViewId, columns, columnSpec, tableId, setView, tableViews, refetchTableViews }: EmbedInputs & EmbedDerived & EmbedRecordActions & EmbedTabActions & { reload: () => void ;}) {
    const onEditSchemaAdapter = (type?: string) => {
        if (type === 'filters' || type === 'sorts') handleOpenConfig();
        else if (ctx.onEditSchema && table) ctx.onEditSchema(table);
    };
    const onCreateRecordAdapter = (templateId?: string) => {
        const tpl = templates.find(t => t.id === templateId) || null;
        void handleCreate({}, tpl);
    };
    // We notify VaultDashboard of the deleted ids so it records them in the
    // its undo stack (the global Cmd+Z lives there). The soft-delete of the view
    // embedded one goes through the shared client and, without this signal, it wasn't undoable.
    const announceDeleted = (ids: readonly string[]) => {
        const clean = [...ids].filter(Boolean);
        if (!clean.length) return;
        emitAppEvent('gnosi:records-deleted', { ids: clean });
    };
    const onDeletePageAdapter = (id: string, title?: VaultViewPage['title']) => { ctx.onDeletePage?.(id, title); if (id) announceDeleted([id]); setTimeout(reload, 400); };
    const onDeleteSelectedAdapter = (ids: Set<string>) => {
        void Promise.allSettled([...ids].map(id => deleteVaultPage(id)))
            .then((results) => {
                const ok = [...ids].filter((_, i) => results[i]?.status === 'fulfilled'
                    || (results[i]?.status === 'rejected' && apiErrorStatus(results[i].reason) === 404));
                announceDeleted(ok);
                reload();
            });
    };
    const onApplyTemplateAdapter = async (ids: Set<string>, templateId: string) => {
        await applyVaultTemplate([...ids], templateId);
        reload();
    };
    const onUpdateViewAdapter = async (input: unknown) => {
        const nextView = decodeViewUpdate(input);
        const registryGroupBy = isRecord(input) ? input.group_by : undefined;
        if (!pageId) return;
        const sorts = Array.isArray(nextView.sort) ? nextView.sort : (nextView.sort ? [nextView.sort] : []);
        // Map updated string columns back to composite objects if the original view used them
        let newVisible: Column[] | undefined = nextView.visibleProperties;
        if (newVisible && Array.isArray(columns) && columns.some(c => typeof c === 'object')) {
            newVisible = nextView.visibleProperties?.map(k => columnSpec.find(c => c.fieldKey === k) || { tableId, fieldKey: k });
        } else if (!newVisible) {
            newVisible = columns;
        }

        // `columnWidths` is sent by VaultTable when resizing a column: without
        // persist it, the widths would revert on every reload (the
        // main view does save them via VaultDashboard).
        const isSection = !view ? false : (activeViewId === view.view_id);
        if (isSection || !activeViewId) {
            // The active tab is the block's section → patch to the section.
            const next = await patchSectionConfig(pageId, view, {
                visible_properties: newVisible,
                sorts,
                sort: sorts[0] || null,
                group_by: nextView.group_by ?? view?.group_by,
                ...(nextView.columnWidths ? { columnWidths: nextView.columnWidths } : {}),
            });
            setView(next);
        } else {
            // Tab of a registry view → direct PUT to /api/vault/views.
            const current = tableViews.find(v => v.id === activeViewId) || {};
            try {
                await updateVaultView(activeViewId, {
                    ...current,
                    visibleProperties: newVisible,
                    sorts,
                    sort: sorts[0] || null,
                    ...(registryGroupBy !== undefined ? { group_by: registryGroupBy } : {}),
                    ...(nextView.columnWidths ? { columnWidths: nextView.columnWidths } : {}),
                });
                await refetchTableViews();
            } catch (e) { reportEmbedError('update view failed', e); }
        }
    };
    const onUpdateNoteAdapter = async (id: unknown, patch: unknown) => {
        if (typeof id !== 'string') return;
        await patchPageMetadata(id, metadata(isRecord(patch) && patch.metadata ? patch.metadata : patch));
        reload();
    };
    return { onEditSchemaAdapter, onCreateRecordAdapter, onDeletePageAdapter, onDeleteSelectedAdapter, onApplyTemplateAdapter, onUpdateViewAdapter, onUpdateNoteAdapter };
}
