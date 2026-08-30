import { useCallback } from 'react';
import { knowledgeDocumentType } from '../../../shared/routing/vaultRouting';
import { vaultPath } from '../../../shared/routing/vaultRouting';
import type { HistoryEntry } from './types';
import type { DashboardState } from './useDashboardState';
type Context = Pick<DashboardState, 'historyPointer' | 'navigate' | 'setHistoryPointer' | 'setNavigationHistory'>;
export function useNavigationHistory(context: Context) {
    const { historyPointer, navigate, setHistoryPointer, setNavigationHistory } = context;
    const pushToHistory = useCallback((entry: HistoryEntry) => {
        // React Router Navigation (URL Synchronization)
        if (entry.type === 'table') {
            const url = entry.subId
                ? vaultPath('knowledge', `table/${entry.id}/view/${entry.subId}`)
                : vaultPath('knowledge', `table/${entry.id}`);
            void navigate(url);
        }
        else if (entry.type === 'editor') {
            const resourceType = entry.resourceType || knowledgeDocumentType(entry);
            void navigate(vaultPath('knowledge', `${resourceType}/${encodeURIComponent(entry.id)}`));
        }
        else {
            const drawingPath = entry.id
                ? `drawing/${encodeURIComponent(entry.id)}`
                : 'drawing';
            void navigate(vaultPath('knowledge', drawingPath));
        }
        setNavigationHistory(prev => {
            const next = prev.slice(0, historyPointer + 1);
            const prevTop = next[next.length - 1];
            // Avoid consecutive duplicates of the same ID and type
            if (prevTop?.id === entry.id && prevTop.type === entry.type && prevTop.subId === entry.subId) {
                return next;
            }
            // Saves the origin (the location we're leaving) so the breadcrumb can
            // return to the actual place the entry was opened from (e.g. a dashboard),
            // not just to the table the record structurally belongs to.
            const from = prevTop ? { type: prevTop.type, id: prevTop.id, subId: prevTop.subId } : null;
            return [...next, { ...entry, from }];
        });
        setHistoryPointer(prev => prev + 1);
    }, [historyPointer, navigate, setHistoryPointer, setNavigationHistory]);
    return { pushToHistory };
}
