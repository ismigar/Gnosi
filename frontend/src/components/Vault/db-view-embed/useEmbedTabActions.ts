import { useCallback } from 'react';
import { fetchVaultViews, fetchVaultViewUsage, deleteVaultView, updateVaultView, createVaultView } from './api';
import { toast } from '../../../lib/toast';
import { reportEmbedError } from './diagnostics';
import { decodeView } from './decode';
import { writeText, pinnedKey } from './preferences';
import type { EmbedView } from './types';
import type { EmbedInputs } from './inputs';
import type { EmbedDerived } from './useEmbedDerived';
export function useEmbedTabActions({ pageId, viewId, tableId, ctx, setTableViews, setPinnedViewIds, setActiveViewId, tableViews, t, setConfirmDeleteView, setDeleteViewUsage, confirmDeleteView, activeViewId, view, renameView, setRenameView, block, headingProp, headingLevelProp, columns }: EmbedInputs & EmbedDerived) {
    const { onOpenViewConfig, onOpenPageViewModal } = ctx;
    const persistPinned = useCallback((set: Set<string>) => { try { writeText(pinnedKey(pageId, viewId), JSON.stringify([...set])); } catch { /* local fallback */ } }, [pageId, viewId]);
    const persistServerTabs = useCallback((set: Set<string>) => { void updateVaultView(viewId, { tabs: [...set] }).catch(() => { }); }, [viewId]);
    const refetchTableViews = useCallback(async () => {
        try {
            const all = await fetchVaultViews();
            setTableViews(all.filter(v => String(v.table_id) === String(tableId)
                || (Array.isArray(v.joins) && v.joins.some(j => String(j.tableId) === String(tableId)))));
        } catch { /* keep the current state */ }
    }, [setTableViews, tableId]);

    const pinView = useCallback((id: string) => {
        if (!id || id === viewId) return;
        setPinnedViewIds(prev => { const next = new Set(prev); next.add(id); persistPinned(next); persistServerTabs(next); return next; });
    }, [viewId, setPinnedViewIds, persistPinned, persistServerTabs]);

    const handleAddView = useCallback((type = 'table') => {
        if (!tableId || !onOpenViewConfig) return;
        onOpenViewConfig({ type: type, name: '' }, (saved: unknown) => {
            const savedView = decodeView(saved);
            if (savedView.id) {
                pinView(savedView.id);
                setActiveViewId(savedView.id);
            }
        });
    }, [tableId, onOpenViewConfig, pinView, setActiveViewId]);

    const handleDeleteView = useCallback((v: EmbedView) => {
        if (!v.id) return;
        if (tableViews.length <= 1) { toast.error(t('errors.delete_only_view', "Cannot delete the only view.")); return; }
        setConfirmDeleteView(v);
        setDeleteViewUsage(null);
        void fetchVaultViewUsage(v.id)
            .then(data => { setDeleteViewUsage(data); })
            .catch(() => { });
    }, [tableViews.length, setConfirmDeleteView, setDeleteViewUsage, t]);

    const doDeleteView = useCallback(async () => {
        const v = confirmDeleteView;
        setConfirmDeleteView(null);
        setDeleteViewUsage(null);
        if (!v?.id) return;
        try {
            await deleteVaultView(v.id);
            await refetchTableViews();
            if (activeViewId === v.id) setActiveViewId(view?.view_id || '');
        } catch (e) { reportEmbedError('delete view failed', e); }
    }, [confirmDeleteView, setConfirmDeleteView, setDeleteViewUsage, refetchTableViews, activeViewId, setActiveViewId, view]);

    // Removes the view from this block ("unpins" it); does NOT delete it from the registry.
    // The section's view (anchor) cannot be removed.
    const handleUnpinView = useCallback((v: EmbedView) => {
        if (!v.id || v.id === viewId) return;
        setPinnedViewIds(prev => { const next = new Set(prev); next.delete(v.id || ''); persistPinned(next); persistServerTabs(next); return next; });
        if (activeViewId === v.id) setActiveViewId(viewId);
    }, [viewId, setPinnedViewIds, activeViewId, setActiveViewId, persistPinned, persistServerTabs]);

    const handleRenameView = useCallback((v: EmbedView) => {
        if (!v.id) return;
        setRenameView(v);
    }, [setRenameView]);

    const doRename = useCallback(async (name: string) => {
        const v = renameView;
        setRenameView(null);
        if (!v?.id) return;
        if (!name || name === (v.name || v.heading)) return;
        try {
            await updateVaultView(v.id, { ...v, name });
            await refetchTableViews();
        } catch (e) { reportEmbedError('rename view failed', e); }
    }, [renameView, setRenameView, refetchTableViews]);

    // Configures a SPECIFIC view (the one from the "..." menu, not necessarily the active one).
    // Same logic as handleOpenConfig but parameterized by `v`: if it's the
    // section's view, it opens the block as-is; if not, it passes a synthetic editingBlock
    // with its view_id (when saving, it re-anchors the section to this view).
    const handleConfigureView = useCallback((v: EmbedView) => {
        if (!onOpenPageViewModal || !tableId) return;
        const sectionVid = block?.props?.view_id || '';
        if (!v.id || v.id === sectionVid) {
            onOpenPageViewModal(tableId, block);
        } else {
            onOpenPageViewModal(tableId, {
                id: block?.id,
                props: { view_id: v.id, heading: headingProp || '', heading_level: headingLevelProp || 1 },
            });
        }
    }, [onOpenPageViewModal, tableId, block, headingProp, headingLevelProp]);

    // Duplicates a view in the registry (a new view with the same filters/sort/
    // columns) and pins it as this block's tab.
    const handleDuplicateView = useCallback(async (v: EmbedView) => {
        if (!v.id || !tableId) return;
        try {
            // FULL copy of the view (like the board's duplicate): copying
            // only filters/sort/columns used to lose all the per-type options
            // (chartType/xField, groupBy, dateField, cardSize…) and copying a
            // chart used to come out empty. The identity fields are removed and
            // rewrite their own.
            const { id: _id, is_main: _im, is_default: _idf, ...rest } = v;
            const sorts = v.sorts || (v.sort ? [v.sort] : []);
            const data = await createVaultView({
                ...rest,
                table_id: tableId,
                name: `${v.name || v.heading || 'Vista'} (còpia)`,
                type: v.type || 'table',
                filters: v.filters || [],
                sorts,
                sort: sorts[0] || null,
                visibleProperties: v.visibleProperties || columns,
                // It originates as a tab of this block, not of the board
                // (isPageEmbedView filters it out of the table tabs).
                embedded: true,
            });
            await refetchTableViews();
            if (data.id) { pinView(data.id); setActiveViewId(data.id); }
        } catch (e) { reportEmbedError('duplicate view failed', e); }
    }, [tableId, columns, refetchTableViews, pinView, setActiveViewId]);
    return { refetchTableViews, pinView, handleAddView, handleDeleteView, doDeleteView, handleUnpinView, handleRenameView, doRename, handleConfigureView, handleDuplicateView };
}
export type EmbedTabActions = ReturnType<typeof useEmbedTabActions>;
