/**
 * useVaultSelection.js
 * Hook to manage multiple row selection in Vault views.
 */
import { useState, useCallback } from 'react';

/**
 * @param {Array} pages - List of available records
 * @returns {{ selectedIds, toggleSelection, toggleSelect, selectAll, clearSelection, isSelected }}
 */
export function useVaultSelection(pages = []) {
    const [selectedIds, setSelectedIds] = useState(new Set());

    const toggleSelection = useCallback((id, isShift = false, allIds = []) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (isShift && allIds.length && prev.size > 0) {
                // Range selection from the last selection (anchor).
                const lastSelected = [...prev].at(-1);
                const lastIdx = allIds.indexOf(lastSelected);
                const currIdx = allIds.indexOf(id);
                // If the anchor is no longer in the current list (e.g. because the search
                // or a filter has removed it) `indexOf` returns -1: the loop would add
                // `allIds[-1]` (undefined) and an incorrect range from index 0. In
                // this case we do a simple toggle of the clicked element.
                if (lastIdx === -1 || currIdx === -1) {
                    if (next.has(id)) next.delete(id); else next.add(id);
                } else {
                    const [from, to] = lastIdx < currIdx ? [lastIdx, currIdx] : [currIdx, lastIdx];
                    for (let i = from; i <= to; i++) {
                        next.add(allIds[i]);
                    }
                }
            } else {
                if (next.has(id)) {
                    next.delete(id);
                } else {
                    next.add(id);
                }
            }
            return next;
        });
    }, []);

    // Alias compatible with existing components: accepts event or boolean
    const toggleSelect = useCallback((id, eventOrShift = false) => {
        const isShift = typeof eventOrShift === 'boolean'
            ? eventOrShift
            : Boolean(eventOrShift?.shiftKey);
        const allIds = pages.map(p => p.id);
        toggleSelection(id, isShift, allIds);
    }, [pages, toggleSelection]);

    const selectAll = useCallback((ids = null) => {
        const sourceIds = Array.isArray(ids) ? ids : pages.map(p => p.id);
        setSelectedIds(new Set(sourceIds));
    }, [pages]);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
    }, []);

    const isSelected = useCallback((id) => selectedIds.has(id), [selectedIds]);

    return { selectedIds, toggleSelection, toggleSelect, selectAll, clearSelection, isSelected };
}
