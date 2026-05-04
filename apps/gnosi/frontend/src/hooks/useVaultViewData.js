/**
 * useVaultViewData.js
 * Hook que encapsula la lògica de filtrat, ordenació i cerca
 * per a les vistes del Vault (Taula, Galeria, Kanban, Timeline, Feed).
 */
import { useMemo } from 'react';
import { matchesFilters, matchesSearch } from '../utils/vaultFilters';

/**
 * @param {Object} params
 * @param {Array}  params.pages       - Llista de pàgines/registres
 * @param {Object} params.schema      - Esquema de la base de dades
 * @param {Object} params.view        - Objecte de vista (filters, sort, visibleProperties)
 * @param {string} params.searchTerm  - Text de cerca
 * @returns {{ filteredPages: Array, sortedPages: Array }}
 */
export function useVaultViewData({ pages = [], schema = {}, view = {}, searchTerm = '' }) {
    const filteredPages = useMemo(() => {
        let result = [...pages];

        // Aplicar cerca i filtres de la vista
        const filters = view.filters || [];
        
        return result.filter(page => {
            // 1. Cerca global
            if (!matchesSearch(page, searchTerm)) return false;
            
            // 2. Filtres de la vista
            if (!matchesFilters(page, filters)) return false;
            
            return true;
        });
    }, [pages, searchTerm, view.filters]);


    const sortedPages = useMemo(() => {
        const sorts = view.sort || [];
        if (!sorts.length) return filteredPages;

        return [...filteredPages].sort((a, b) => {
            for (const sort of sorts) {
                const aVal = sort.field === 'title'
                    ? (a.title || '')
                    : String((a.metadata || {})[sort.field] ?? '');
                const bVal = sort.field === 'title'
                    ? (b.title || '')
                    : String((b.metadata || {})[sort.field] ?? '');

                const aNum = parseFloat(aVal);
                const bNum = parseFloat(bVal);
                const isNumeric = !isNaN(aNum) && !isNaN(bNum);

                let cmp = isNumeric ? aNum - bNum : aVal.localeCompare(bVal, 'ca', { sensitivity: 'base' });
                if (sort.direction === 'desc') cmp = -cmp;
                if (cmp !== 0) return cmp;
            }
            return 0;
        });
    }, [filteredPages, view.sort]);

    return { filteredPages, sortedPages };
}
