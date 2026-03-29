/**
 * useVaultSelection.js
 * Hook per gestionar la selecció múltiple de files en les vistes del Vault.
 */
import { useState, useCallback } from 'react';

/**
 * @param {Array} pages - Llista de registres disponibles
 * @returns {{ selectedIds, toggleSelection, selectAll, clearSelection, isSelected }}
 */
export function useVaultSelection(pages = []) {
    const [selectedIds, setSelectedIds] = useState(new Set());

    const toggleSelection = useCallback((id, isShift = false, allIds = []) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (isShift && allIds.length && prev.size > 0) {
                // Selecció per rang
                const lastSelected = [...prev].at(-1);
                const lastIdx = allIds.indexOf(lastSelected);
                const currIdx = allIds.indexOf(id);
                const [from, to] = lastIdx < currIdx ? [lastIdx, currIdx] : [currIdx, lastIdx];
                for (let i = from; i <= to; i++) {
                    next.add(allIds[i]);
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

    const selectAll = useCallback(() => {
        setSelectedIds(new Set(pages.map(p => p.id)));
    }, [pages]);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
    }, []);

    const isSelected = useCallback((id) => selectedIds.has(id), [selectedIds]);

    return { selectedIds, toggleSelection, selectAll, clearSelection, isSelected };
}
