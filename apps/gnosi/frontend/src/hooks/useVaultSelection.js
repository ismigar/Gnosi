/**
 * useVaultSelection.js
 * Hook per gestionar la selecció múltiple de files en les vistes del Vault.
 */
import { useState, useCallback } from 'react';

/**
 * @param {Array} pages - Llista de registres disponibles
 * @returns {{ selectedIds, toggleSelection, toggleSelect, selectAll, clearSelection, isSelected }}
 */
export function useVaultSelection(pages = []) {
    const [selectedIds, setSelectedIds] = useState(new Set());

    const toggleSelection = useCallback((id, isShift = false, allIds = []) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (isShift && allIds.length && prev.size > 0) {
                // Selecció per rang des de l'última selecció (àncora).
                const lastSelected = [...prev].at(-1);
                const lastIdx = allIds.indexOf(lastSelected);
                const currIdx = allIds.indexOf(id);
                // Si l'àncora ja no és a la llista actual (p. ex. perquè la cerca
                // o un filtre l'han tret) `indexOf` torna -1: el bucle afegiria
                // `allIds[-1]` (undefined) i un rang erroni des de l'índex 0. En
                // aquest cas fem un toggle simple de l'element clicat.
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

    // Alias compatible amb els components existents: rep event o booleà
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
