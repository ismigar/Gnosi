/**
 * useVaultViewData.js
 * Hook que encapsula la lògica de filtrat, ordenació i cerca
 * per a les vistes del Vault (Taula, Galeria, Kanban, Timeline, Feed).
 */
import { useMemo } from 'react';
import { matchesFilters, matchesSearch, compareFieldValues } from '../utils/vaultFilters';
import { normalizeSorts } from '../components/Vault/schemaUtils';

/**
 * @param {Object} params
 * @param {Array}  params.pages       - Llista de pàgines/registres
 * @param {Object} params.schema      - Esquema de la base de dades
 * @param {Object} params.view        - Objecte de vista (filters, sort, visibleProperties)
 * @param {string} params.searchTerm  - Text de cerca
 * @returns {{ filteredPages: Array, sortedPages: Array }}
 */
// Nota: el param `schema` no s'usa actualment però es manté a la signatura
// perquè diversos consumers ja el passen — eliminar-lo trencaria callers.
// Marcat amb sufix `_unused` perquè ESLint no flagi.
// eslint-disable-next-line no-unused-vars
export function useVaultViewData({ pages = [], schema: _schema = {}, view = {}, searchTerm = '' }) {
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
        // `normalizeSorts` tolera les dues formes històriques del camp d'ordre
        // (objecte {field,direction} O array) i, a més, les dues claus que els
        // callers fan servir: la vista de taula passa `sort` (array) mentre que
        // galeria/kanban/feed/timeline passen `sorts` (sovint un OBJECTE per
        // defecte). Abans es llegia només `view.sort` i `sorts.length` sobre un
        // objecte/undefined era falsy → aquestes vistes NO s'ordenaven.
        const sorts = normalizeSorts(view.sort ?? view.sorts);
        if (!sorts.length) return filteredPages;

        return [...filteredPages].sort((a, b) => {
            for (const sort of sorts) {
                // Comparador compartit (vaultFilters.compareFieldValues): buits
                // SEMPRE al final, ordre numèric per a valors numèrics i
                // localeCompare normalitzat per la resta. Mateixa lògica per a
                // la vista principal i les vistes incrustades (paritat 1:1).
                // Fallback al camp TOP-LEVEL de la pàgina (paritat amb
                // matchesFilters): `last_modified`/`created` no viuen al
                // metadata, i sense el fallback el sort per aquests camps —
                // inclòs el d'ordre per defecte "més recent primer" — era un
                // no-op silenciós (undefined vs undefined → 0).
                const aRaw = sort.field === 'title' ? (a.title || '') : ((a.metadata || {})[sort.field] ?? a[sort.field]);
                const bRaw = sort.field === 'title' ? (b.title || '') : ((b.metadata || {})[sort.field] ?? b[sort.field]);
                const cmp = compareFieldValues(aRaw, bRaw, sort.direction);
                if (cmp !== 0) return cmp;
            }
            return 0;
        });
    }, [filteredPages, view.sort, view.sorts]);

    return { filteredPages, sortedPages };
}
