import { useCallback } from 'react';
import { deleteVaultPage } from '../../shared/api/vaults';
import { restoreVaultPage } from '../../shared/api/vaults';
import { toast } from '../../lib/toast';
import { errorStatus } from './readers';
import type { DashboardState } from './useDashboardState';
import type { useDataLoading } from './useDataLoading';
import type { useDocumentTabs } from './useDocumentTabs';
import type { useRecordCatalog } from './useRecordCatalog';
import type { useRelationHistory } from './useRelationHistory';
type Context = Pick<DashboardState, 'activeTableId' | 'pages' | 'redoStack' | 'setRedoStack' | 'setUndoStack' | 't' | 'undoStack'> & Pick<ReturnType<typeof useDataLoading>, 'fetchPages' | 'fetchPagesByTable'> & Pick<ReturnType<typeof useDocumentTabs>, 'handleTabClose'> & Pick<ReturnType<typeof useRecordCatalog>, 'syncPagesState'> & Pick<ReturnType<typeof useRelationHistory>, 'applyRelationHistoryValue'>;
export function useUndoRedo(context: Context) {
    const { activeTableId, applyRelationHistoryValue, fetchPages, fetchPagesByTable, handleTabClose, pages, redoStack, setRedoStack, setUndoStack, syncPagesState, t, undoStack } = context;
    const undoLastOperation = useCallback(async () => {
        if (undoStack.length === 0)
            return;
        const operation = undoStack[undoStack.length - 1];
        if (!operation)
            return;
        if (operation.type === 'delete') {
            const results = await Promise.allSettled(operation.ids.map(id => restoreVaultPage(id)));
            const succeeded: string[] = [];
            const failed: {
                id: string;
                status?: number;
            }[] = [];
            results.forEach((r, i) => {
                const id = operation.ids[i];
                if (id === undefined)
                    return;
                if (r.status === 'fulfilled')
                    succeeded.push(id);
                else
                    failed.push({ id, status: errorStatus(r.reason) });
            });
            if (activeTableId)
                void fetchPagesByTable(activeTableId);
            else
                void fetchPages();
            if (succeeded.length > 0) {
                toast.success(t('vault.records_restored', { count: succeeded.length }));
            }
            if (failed.length > 0) {
                const reasons = failed.map(f => f.status || '?').join(', ');
                toast.error(t('vault.records_restore_failed', { count: failed.length, reasons }));
            }
            if (succeeded.length === 0) {
                // No restoration: we keep the operation in undoStack for a retry.
                return;
            }
            // If partial, only the succeeded ones are candidates for "redo" — the
            // rest can no longer be deleted because it might already be.
            setRedoStack(prev => [...prev, { type: 'delete', ids: succeeded }]);
        }
        else {
            const restored = await applyRelationHistoryValue(operation, operation.previousValue);
            if (!restored)
                return;
            toast.success(t('relation_item.undo_success', 'Relation restored'));
            setRedoStack(prev => [...prev, operation]);
        }
        setUndoStack(prev => prev.slice(0, -1));
    }, [undoStack, setUndoStack, activeTableId, fetchPagesByTable, fetchPages, setRedoStack, t, applyRelationHistoryValue]);
    const redoLastOperation = useCallback(async () => {
        if (redoStack.length === 0)
            return;
        const operation = redoStack[redoStack.length - 1];
        if (!operation)
            return;
        if (operation.type === 'delete') {
            const results = await Promise.allSettled(operation.ids.map(id => deleteVaultPage(id)));
            const succeeded: string[] = [];
            const failed: {
                id: string;
                status?: number;
            }[] = [];
            results.forEach((r, i) => {
                const id = operation.ids[i];
                if (id === undefined)
                    return;
                if (r.status === 'fulfilled' || errorStatus(r.reason) === 404) {
                    succeeded.push(id);
                }
                else {
                    failed.push({ id, status: errorStatus(r.reason) });
                }
            });
            if (succeeded.length > 0) {
                const nextPages = pages.filter(p => !succeeded.includes(p.id));
                syncPagesState(nextPages);
                succeeded.forEach(id => { handleTabClose(id); });
                toast.success(t('vault.records_redeleted', { count: succeeded.length }));
            }
            if (failed.length > 0) {
                const reasons = failed.map(f => f.status || '?').join(', ');
                toast.error(t('vault.records_redelete_failed', { count: failed.length, reasons }));
            }
            if (activeTableId)
                void fetchPagesByTable(activeTableId);
            else
                void fetchPages();
            if (succeeded.length === 0)
                return;
            setUndoStack(prev => [...prev, { type: 'delete', ids: succeeded }]);
        }
        else {
            const reapplied = await applyRelationHistoryValue(operation, operation.nextValue);
            if (!reapplied)
                return;
            toast.success(t('relation_item.redo_success', 'Relation removed again'));
            setUndoStack(prev => [...prev, operation]);
        }
        setRedoStack(prev => prev.slice(0, -1));
    }, [redoStack, setRedoStack, activeTableId, fetchPagesByTable, fetchPages, setUndoStack, pages, syncPagesState, t, handleTabClose, applyRelationHistoryValue]);
    return { undoLastOperation, redoLastOperation };
}
