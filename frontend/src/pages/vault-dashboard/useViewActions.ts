import { readView } from './readers';
import { createVaultView } from '../../shared/api/vault-views';
import { deleteVaultView } from '../../shared/api/vault-views';
import { fetchVaultViewUsage } from '../../shared/api/vault-views';
import { reorderVaultViews } from '../../shared/api/vault-views';
import { updateVaultView } from '../../shared/api/vault-views';
import { toast } from '../../lib/toast';
import { v4 as uuidv4 } from 'uuid';
import { isMainView } from '../../components/Vault/viewConstants';
import { isViewHidden } from '../../components/Vault/viewConstants';
import type { View, ViewDraft } from './types';
import type { DashboardState } from './useDashboardState';
import type { useDataLoading } from './useDataLoading';
import type { useDocumentTabs } from './useDocumentTabs';
import type { useViewCatalog } from './useViewCatalog';
type Context = Pick<DashboardState, 'activeTableId' | 'activeViewId' | 'registry' | 'setActiveViewId' | 'setPromptModal' | 'setViewToDelete' | 'setViewToDeleteUsage' | 'setViews' | 't' | 'viewToDelete' | 'views'> & Pick<ReturnType<typeof useDataLoading>, 'fetchPagesByTable' | 'fetchRegistry'> & Pick<ReturnType<typeof useDocumentTabs>, 'handleTabClose'> & Pick<ReturnType<typeof useViewCatalog>, 'buildMainViewBody' | 'getTableViews'>;
export function useViewActions(context: Context) {
    const { activeTableId, activeViewId, buildMainViewBody, fetchPagesByTable, fetchRegistry, getTableViews, handleTabClose, registry, setActiveViewId, setPromptModal, setViewToDelete, setViewToDeleteUsage, setViews, t, viewToDelete, } = context;
    const handleUpdateView = async (updatedView: ViewDraft) => {
        if (!updatedView.id)
            return;
        // Never persist the virtual main view: its id is the literal 'default'
        // (from ensureMainViewForTable), and PUTting it upserts a registry view
        // whose id collides across tables — a later save on another table then
        // overwrites the first table's entry. A real saved view has a unique id.
        if (updatedView.id === 'default')
            return;
        const viewId = updatedView.id;
        try {
            const tableId = updatedView.table_id || activeTableId;
            const tableViews = getTableViews(tableId);
            const main = isMainView(updatedView, tableViews);
            // The main view no longer rewrites `visibleProperties` on every
            // the schema on save: this was silently destroying the field config
            // of the main views (e.g. those imported from Notion) when
            // first change of order or column width. Now every view
            // preserve and respect its configured fields.
            let newVisible = updatedView.visibleProperties;
            const originalVisible = registry.views.find(v => v.id === viewId)?.visibleProperties;
            if (newVisible?.every(c => typeof c === 'string') && originalVisible?.some(c => typeof c === 'object')) {
                newVisible = newVisible.map(k => originalVisible.find(c => typeof c === 'object' && c.fieldKey === k) || { tableId: tableId, fieldKey: k });
                updatedView = { ...updatedView, visibleProperties: newVisible };
            }
            const normalizedView = main
                ? {
                    ...updatedView,
                    ...buildMainViewBody(tableId),
                    id: updatedView.id,
                    table_id: tableId,
                    is_main: true,
                }
                : {
                    ...updatedView,
                    is_main: false,
                };
            await updateVaultView(viewId, normalizedView);
            await fetchRegistry();
            // Refresh current table pages to show possible new quick-entry records
            if (activeTableId) {
                await fetchPagesByTable(activeTableId);
            }
        }
        catch (err) {
            console.error("Error updating view:", err);
            toast.error(t('errors.save_view'));
        }
    };
    const handleDuplicateView = async (targetView: string | ViewDraft) => {
        const viewId = typeof targetView === 'string' ? targetView : targetView.id;
        const view = (registry.views.find(v => v.id === viewId)) ||
            (typeof targetView === 'object' ? targetView : null);
        if (!view)
            return;
        const newView = {
            ...view,
            id: uuidv4(),
            name: `${String(view.name)} (${t('common.copy')})`,
            order: (view.order !== undefined ? view.order : 0) + 0.5,
            table_id: view.table_id || activeTableId,
            is_main: false,
            // A duplicate made from the dashboard is a full-fledged tab,
            // even if the original was the main one from an embed origin (with
            // the "this" filter): without this, the copy would end up invisible.
            embedded: false,
        };
        try {
            await createVaultView(newView);
            await fetchRegistry();
            setActiveViewId(newView.id);
            toast.success(t('success.view_duplicated'));
        }
        catch (err) {
            console.error("Error duplicating view:", err);
            toast.error(t('errors.duplicate_view', 'Could not duplicate view'));
        }
    };
    const handleDeleteView = (targetView: string | ViewDraft) => {
        const view = typeof targetView === 'object' ? targetView : registry.views.find(v => v.id === targetView);
        if (!view)
            return;
        const tableViews = getTableViews(view.table_id || activeTableId);
        if (isMainView(view, tableViews)) {
            toast.error(t('errors.delete_main_view'));
            return;
        }
        if (!view.id)
            return;
        setViewToDelete(readView(view));
        setViewToDeleteUsage(null);
        fetchVaultViewUsage(view.id)
            .then(usage => {
            setViewToDeleteUsage(usage);
        })
            .catch(() => { });
    };
    const executeDeleteView = async () => {
        if (!viewToDelete)
            return;
        try {
            await deleteVaultView(viewToDelete.id);
            await fetchRegistry();
            if (activeViewId === viewToDelete.id) {
                const remaining = registry.views
                    .filter(v => v.table_id === viewToDelete.table_id && v.id !== viewToDelete.id);
                setActiveViewId(remaining[0]?.id || 'default');
            }
            handleTabClose(viewToDelete.id);
            toast.success(t('success.view_deleted'));
        }
        catch (err) {
            console.error("Error deleting view:", err);
            toast.error(t('errors.delete_view'));
        }
        finally {
            setViewToDelete(null);
            setViewToDeleteUsage(null);
        }
    };
    const handleReorderViews = async (reorderedViews: readonly View[]) => {
        // Persists the order via a single atomic PUT (no race condition with
        // concurrent POSTs that didn't move the registry entries).
        if (reorderedViews.length === 0)
            return;
        const tableId = reorderedViews[0]?.table_id;
        if (!tableId)
            return;
        const orderedIds = reorderedViews.map(v => v.id);
        // Optimistic UI: updates local state before the round-trip.
        setViews([...reorderedViews]);
        try {
            await reorderVaultViews({
                table_id: tableId,
                ordered_ids: orderedIds,
            });
            await fetchRegistry();
        }
        catch (err) {
            console.error("Error reordering views:", err);
            toast.error(t('errors.reorder_views', "Error reordering views"));
            await fetchRegistry();
        }
    };
    const handleSetViewHidden = async (targetView: string | ViewDraft, hidden: boolean) => {
        const viewId = typeof targetView === 'string' ? targetView : targetView.id;
        if (!viewId)
            return;
        const tableId = (typeof targetView === 'object' ? targetView.table_id : null) || activeTableId;
        const tableViews = getTableViews(tableId);
        const view = tableViews.find(v => v.id === viewId);
        if (!view)
            return;
        // The main view is never hidden: there must always remain one anchor tab.
        if (isMainView(view, tableViews)) {
            toast.error(t('errors.hide_main_view', "The main view cannot be hidden"));
            return;
        }
        // If we hide the active view, we jump to the first visible one (or to the main one).
        if (hidden && activeViewId === viewId) {
            const fallback = tableViews.find(v => v.id !== viewId && !isViewHidden(v, tableViews))
                || tableViews.find(v => isMainView(v, tableViews));
            if (fallback)
                setActiveViewId(fallback.id);
        }
        try {
            await updateVaultView(viewId, { ...view, hidden });
            await fetchRegistry();
        }
        catch (err) {
            console.error("Error changing view visibility:", err);
            toast.error(t('errors.save_view'));
            await fetchRegistry();
        }
    };
    const handleRenameView = (targetView: string | ViewDraft) => {
        const viewId = typeof targetView === 'string' ? targetView : targetView.id;
        const view = (registry.views.find(v => v.id === viewId)) ||
            (typeof targetView === 'object' ? targetView : null);
        if (!view)
            return;
        setPromptModal({
            isOpen: true,
            defaultTitle: view.name || '',
            inputValue: view.name || '',
            isView: true,
            isRename: true,
            targetView: view,
            isLoading: false
        });
    };
    return { handleUpdateView, handleDuplicateView, handleDeleteView, executeDeleteView, handleReorderViews, handleSetViewHidden, handleRenameView };
}
