import { emitAppEvent } from '../../shared/platform/app-events';
import { useCallback } from 'react';
import { patchVaultPage } from '../../shared/api/vaults';
import { notifyError } from '../../lib/notifyError';
import { RELATION_VALUE_APPLIED_EVENT } from '../../components/Vault/relationItemUtils';
import type { Page, RelationOperation } from './types';
import type { DashboardState } from './useDashboardState';
import type { useDataLoading } from './useDataLoading';
type Context = Pick<DashboardState, 'activeTableId' | 'pagesRef' | 'setPages' | 'setTableNotes' | 'setTabs' | 'setVisibleTableRecordsById' | 't'> & Pick<ReturnType<typeof useDataLoading>, 'fetchPages' | 'fetchPagesByTable'>;
export function useRelationHistory(context: Context) {
    const { activeTableId, fetchPages, fetchPagesByTable, pagesRef, setPages, setTableNotes, setTabs, setVisibleTableRecordsById, t } = context;
    const applyRelationHistoryValue = useCallback(async (operation: RelationOperation, value: readonly string[]) => {
        const applyLocalValue = (localValue: readonly string[]) => {
            const patchPage = <T extends Page>(page: T): T => (page.id === operation.pageId
                ? { ...page, metadata: { ...(page.metadata || {}), [operation.metadataKey]: localValue } }
                : page);
            setTabs(prev => prev.map(patchPage));
            setPages(prev => {
                const next = prev.map(patchPage);
                pagesRef.current = next;
                return next;
            });
            setTableNotes(prev => prev.map(patchPage));
            setVisibleTableRecordsById(prev => {
                let changed = false;
                const next: Record<string, Page[]> = {};
                for (const [tableId, records] of Object.entries(prev)) {
                    if (!Array.isArray(records)) {
                        next[tableId] = records;
                        continue;
                    }
                    const patched = records.map(patchPage);
                    if (patched.some((record, index) => record !== records[index]))
                        changed = true;
                    next[tableId] = patched;
                }
                return changed ? next : prev;
            });
            emitAppEvent(RELATION_VALUE_APPLIED_EVENT, {
                pageId: operation.pageId,
                metadataKey: operation.metadataKey,
                value: localValue,
            });
        };
        const isUndoValue = JSON.stringify(value) === JSON.stringify(operation.previousValue);
        const rollbackValue = isUndoValue ? operation.nextValue : operation.previousValue;
        applyLocalValue(value);
        try {
            await patchVaultPage(operation.pageId, {
                metadata: { [operation.metadataKey]: value },
            });
            // A relation unlink starts its own background refresh. Undo can
            // overtake that request, whose stale response would otherwise repaint
            // the removed value after the optimistic restoration. Refresh again
            // after the older request has had time to settle.
            void fetchPages();
            if (activeTableId)
                void fetchPagesByTable(activeTableId);
            window.setTimeout(() => {
                void fetchPages();
                if (activeTableId)
                    void fetchPagesByTable(activeTableId);
            }, 1800);
            window.setTimeout(() => {
                void fetchPages();
                if (activeTableId)
                    void fetchPagesByTable(activeTableId);
            }, 3600);
            return true;
        }
        catch (error) {
            applyLocalValue(rollbackValue);
            notifyError('relation-history', error, t('relation_item.history_error', 'Could not restore the relation change'));
            return false;
        }
    }, [activeTableId, fetchPages, fetchPagesByTable, pagesRef, setPages, setTableNotes, setTabs, setVisibleTableRecordsById, t]);
    return { applyRelationHistoryValue };
}
