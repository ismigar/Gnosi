/**
 * useVaultViewData.js
 * Hook que encapsula la lògica de filtrat, ordenació i cerca
 * per a les vistes del Vault (Taula, Galeria, Kanban, Timeline, Feed).
 */
import { useMemo } from 'react';
import { evaluateFormula } from '../components/Vault/formulaUtils';

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

        // Filtratge per cerca de text
        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            result = result.filter(page => {
                const title = (page.title || '').toLowerCase();
                if (title.includes(q)) return true;
                const metadata = page.metadata || {};
                return Object.values(metadata).some(v => String(v || '').toLowerCase().includes(q));
            });
        }

        // Aplicar filtres de la vista
        const filters = view.filters || [];
        if (filters.length > 0) {
            result = result.filter(page => {
                return filters.every(filter => {
                    const rawVal = filter.field === 'title'
                        ? (page.title || '')
                        : ((page.metadata || {})[filter.field] ?? '');
                    const val = String(rawVal).toLowerCase();
                    const filterVal = String(filter.value || '').toLowerCase();

                    switch (filter.operator) {
                        case 'equals': return val === filterVal;
                        case 'not_equals': return val !== filterVal;
                        case 'contains': return val.includes(filterVal);
                        case 'not_contains': return !val.includes(filterVal);
                        case 'is_empty': return !rawVal || rawVal === '';
                        case 'is_not_empty': return rawVal && rawVal !== '';
                        case 'greater_than': return parseFloat(rawVal) > parseFloat(filterVal);
                        case 'less_than': return parseFloat(rawVal) < parseFloat(filterVal);
                        default: return true;
                    }
                });
            });
        }

        return result;
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
