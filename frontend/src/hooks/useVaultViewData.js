/**
 * useVaultViewData.js
 * Hook that encapsulates the filtering, sorting, and search logic
 * for Vault views (Table, Gallery, Kanban, Timeline, Feed).
 */
import { useMemo } from 'react';
import { viewMatchesFilters, matchesSearch, compareFieldValues } from '../utils/vaultFilters';
import { normalizeSorts } from '../components/Vault/schemaUtils';

/**
 * @param {Object} params
 * @param {Array}  params.pages       - List of pages/records
 * @param {Object} params.schema      - Database schema
 * @param {Object} params.view        - View object (filters, sort, visibleProperties)
 * @param {string} params.searchTerm  - Search text
 * @returns {{ filteredPages: Array, sortedPages: Array }}
 */
// Note: the `schema` param is not currently used but is kept in the signature
// because several consumers already pass it — removing it would break callers.
// Marked with `_unused` suffix so ESLint doesn't flag it.
// eslint-disable-next-line no-unused-vars
export function useVaultViewData({ pages = [], schema: _schema = {}, view = {}, searchTerm = '' }) {
    const filteredPages = useMemo(() => {
        let result = [...pages];

        return result.filter(page => {
            // 1. Global search
            if (!matchesSearch(page, searchTerm)) return false;

            // 2. View filters — prefers the nested `filterTree` (complex AND/OR
            // groups) and falls back to the legacy flat `filters` list (AND).
            if (!viewMatchesFilters(page, view)) return false;

            return true;
        });
    }, [pages, searchTerm, view.filters, view.filterTree]);


    const sortedPages = useMemo(() => {
        // `normalizeSorts` tolerates both historical forms of the sort field
        // (object {field,direction} OR array) and, in addition, the two keys that
        // callers use: the table view passes `sort` (array) while
        // gallery/kanban/feed/timeline pass `sorts` (often an OBJECT for
        // default). Before, only `view.sort` was read and `sorts.length` on an
        // object/undefined was falsy → these views were NOT sorted.
        const sorts = normalizeSorts(view.sort ?? view.sorts);
        if (!sorts.length) return filteredPages;

        return [...filteredPages].sort((a, b) => {
            for (const sort of sorts) {
                // Shared comparator (vaultFilters.compareFieldValues): empty values
                // ALWAYS at the end, numeric order for numeric values and
                // normalized localeCompare for the rest. Same logic for
                // the main view and embedded views (1:1 parity).
                // Fallback to the page's TOP-LEVEL field (parity with
                // matchesFilters): `last_modified`/`created` don't live in the
                // metadata, and without the fallback the sort for these fields —
                // including the default "most recent first" sort — it was a
                // silent no-op (undefined vs undefined → 0).
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
