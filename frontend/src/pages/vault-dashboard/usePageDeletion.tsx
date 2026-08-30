import { emitAppEvent } from '../../shared/platform/app-events';
import { useCallback } from 'react';
import { deleteVaultPage } from '../../shared/api/vaults';
import { restoreVaultPage } from '../../shared/api/vaults';
import { toast } from '../../lib/toast';
import { knowledgeDocumentType } from '../../lib/vaultRouting';
import { vaultPath } from '../../lib/vaultRouting';
import { errorStatus } from './readers';
import { getTableIdFromTab } from './tab-model';
import type { Page } from './types';
import type { VaultViewPage } from '../../hooks/useVaultViewData';
import type { DashboardState } from './useDashboardState';
import type { useDataLoading } from './useDataLoading';
import type { useDocumentTabs } from './useDocumentTabs';
import type { useNavigationHistory } from './useNavigationHistory';
type Context = Pick<DashboardState, 'activeTableId' | 'navigate' | 'nestedPath' | 'setPages' | 'setRedoStack' | 'setTableNotes' | 'setUndoStack' | 'setVisibleTableRecordsById' | 't' | 'tabs'> & Pick<ReturnType<typeof useDataLoading>, 'fetchPages' | 'fetchPagesByTable'> & Pick<ReturnType<typeof useDocumentTabs>, 'handleTabClose'> & Pick<ReturnType<typeof useNavigationHistory>, 'pushToHistory'>;
export function usePageDeletion(context: Context) {
    const { activeTableId, fetchPages, fetchPagesByTable, handleTabClose, navigate, nestedPath, pushToHistory, setPages, setRedoStack, setTableNotes, setUndoStack, setVisibleTableRecordsById, t, tabs } = context;
    const handleDeletePage = useCallback(async (pageId: string, pageTitle?: VaultViewPage['title']) => {
        if (!pageId)
            return;
        const id = pageId;
        const title = pageTitle || t('common.untitled', "Untitled");
        const removeFromState = () => {
            emitAppEvent('gnosi:page-deleted', { pageId: id });
            setPages(prev => prev.filter(page => page.id !== id));
            setTableNotes(prev => prev.filter(note => note.id !== id));
            setVisibleTableRecordsById(prev => {
                const next: Record<string, Page[]> = {};
                for (const [tableId, notes] of Object.entries(prev)) {
                    next[tableId] = notes.filter(n => n.id !== id);
                }
                return next;
            });
            handleTabClose(id);
            if (nestedPath && nestedPath.includes(id)) {
                // We return to the tab that `handleTabClose` has promoted (typically
                // the dashboard or parent table it had been opened from
                // the entry), instead of falling back to `/vault` (the "Hola" screen
                // empty) and leave the user without context.
                const remaining = tabs.filter(tab => tab.id !== id);
                const fallback = remaining[remaining.length - 1];
                if (fallback?.isDrawing) {
                    pushToHistory({ type: 'drawing', id: fallback.id });
                }
                else if (fallback?.isTable) {
                    const tableId = getTableIdFromTab(fallback);
                    if (tableId)
                        pushToHistory({ type: 'table', id: tableId });
                    else
                        void navigate(vaultPath('knowledge'));
                }
                else if (fallback) {
                    pushToHistory({
                        type: 'editor',
                        id: fallback.id,
                        resourceType: knowledgeDocumentType(fallback),
                    });
                }
                else {
                    void navigate(vaultPath('knowledge'));
                }
            }
        };
        const refreshAfterDelete = () => {
            if (activeTableId)
                void fetchPagesByTable(activeTableId);
            else
                void fetchPages();
        };
        const restorePage = async () => {
            try {
                await restoreVaultPage(id);
                refreshAfterDelete();
                toast.success(t('success.page_restored'));
            }
            catch (err) {
                console.error('Error restoring the page:', err);
                toast.error(t('errors.restore_page'));
            }
        };
        try {
            await deleteVaultPage(id);
            removeFromState();
            refreshAfterDelete();
            toast((tObj) => (<span className="flex items-center gap-3">
                    <span className="truncate max-w-[16rem]">
                        "{title}" {t('vault.moved_to_trash')}
                    </span>
                    <button type="button" onClick={() => {
                    toast.dismiss(tObj.id);
                    void restorePage();
                }} className="px-2 py-0.5 rounded text-xs font-semibold bg-[var(--gnosi-primary)] text-white hover:opacity-90">
                        {t('common.undo', "Undo")}
                    </button>
                </span>), { duration: 8000 });
        }
        catch (err) {
            // 404: it's no longer on disk; local cleanup and a ghost warning.
            if (errorStatus(err) === 404) {
                removeFromState();
                refreshAfterDelete();
                toast.success(t('success.page_deleted_ghost', "Page deleted (ghost cache entry)"));
            }
            else {
                console.error('Error moving the page to trash:', err);
                toast.error(t('errors.delete_page', "Error deleting page"));
            }
        }
    }, [t, setPages, setTableNotes, setVisibleTableRecordsById, handleTabClose, nestedPath, tabs, pushToHistory, navigate, activeTableId, fetchPagesByTable, fetchPages]);
    const handleDeleteSelected = useCallback(async (selectedIds: ReadonlySet<string>) => {
        const idArray = [...selectedIds];
        if (idArray.length === 0)
            return;
        const refreshAfter = () => {
            if (activeTableId)
                void fetchPagesByTable(activeTableId);
            else
                void fetchPages();
        };
        // Restore with partial error reporting. Returns {succeeded, failed}.
        const restoreMany = async (ids: string[]) => {
            const results = await Promise.allSettled(ids.map(id => restoreVaultPage(id)));
            const succeeded: string[] = [];
            const failed: {
                id: string;
                status?: number;
            }[] = [];
            results.forEach((r, i) => {
                const id = ids[i];
                if (id === undefined)
                    return;
                if (r.status === 'fulfilled')
                    succeeded.push(id);
                else
                    failed.push({ id, status: errorStatus(r.reason) });
            });
            refreshAfter();
            if (succeeded.length > 0) {
                toast.success(t('vault.records_restored', { count: succeeded.length }));
            }
            if (failed.length > 0) {
                const reasons = failed.map(f => f.status || '?').join(', ');
                toast.error(t('vault.records_restore_failed', { count: failed.length, reasons }));
            }
            return { succeeded, failed };
        };
        // DELETE: 404 → treated as success (it's no longer on disk; it still needs to be removed from
        // local state anyway); 200/2xx → success; anything else → failed.
        const deleteResults = await Promise.allSettled(idArray.map(id => deleteVaultPage(id)));
        const deletedIds: string[] = [];
        const failedDeletes: {
            id: string;
            status?: number;
        }[] = [];
        deleteResults.forEach((r, i) => {
            const id = idArray[i];
            if (id === undefined)
                return;
            if (r.status === 'fulfilled') {
                deletedIds.push(id);
            }
            else if (errorStatus(r.reason) === 404) {
                deletedIds.push(id);
            }
            else {
                failedDeletes.push({ id, status: errorStatus(r.reason) });
            }
        });
        // Optimistic update only for confirmed ids.
        setPages(prev => prev.filter(p => !deletedIds.includes(p.id)));
        setTableNotes(prev => prev.filter(p => !deletedIds.includes(p.id)));
        setVisibleTableRecordsById(prev => {
            const next: Record<string, Page[]> = {};
            for (const [tableId, notes] of Object.entries(prev)) {
                next[tableId] = notes.filter(n => !deletedIds.includes(n.id));
            }
            return next;
        });
        deletedIds.forEach(id => { handleTabClose(id); });
        if (deletedIds.length > 0) {
            setUndoStack(prev => [...prev, { type: 'delete', ids: deletedIds }]);
            setRedoStack([]);
        }
        refreshAfter();
        if (failedDeletes.length > 0) {
            const reasons = failedDeletes.map(f => f.status || '?').join(', ');
            toast.error(t('vault.records_delete_failed', { count: failedDeletes.length, reasons }));
        }
        if (deletedIds.length === 0)
            return;
        const count = deletedIds.length;
        toast((tObj) => (<span className="flex items-center gap-3">
                <span>
                    {t('vault.records_trashed', { count })}
                </span>
                <button type="button" onClick={() => {
                toast.dismiss(tObj.id);
                void restoreMany(deletedIds);
            }} className="px-2 py-0.5 rounded text-xs font-semibold bg-[var(--gnosi-primary)] text-white hover:opacity-90">
                    {t('common.undo')}
                </button>
            </span>), { duration: 8000 });
    }, [setPages, setTableNotes, setVisibleTableRecordsById, activeTableId, fetchPagesByTable, fetchPages, t, handleTabClose, setUndoStack, setRedoStack]);
    return { handleDeletePage, handleDeleteSelected };
}
