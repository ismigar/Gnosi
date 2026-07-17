/**
 * vaultFilters.js
 * Shared filtering utilities for the Vault and the Graph.
 */

// Values that a checkbox considers "checked" (parity with the backend:
// rule_engine._is_truthy_checkbox and view_snapshot._as_bool). Any other
// anything else —missing field, "", "false", 0…— is "unchecked".
const TRUTHY = new Set(['true', '1', 'yes', 'si', 'sí', 'done', 'checked', 'completat']);

// A value only counts as NUMERIC if the WHOLE string is a number (digits,
// separadors, exponent). `parseFloat` parseja PREFIXOS ('2024-07-05' → 2024),
// so without this check dates were being treated as numbers (and the
// date-range filter / sorting were failing). Shared source of truth
// for the 3 filter engines (matchesFilters, DbViewEmbed.applyFilter) and for the
// sort comparator (compareFieldValues); parity with `_FULL_NUMERIC_RE`
// from the backend (view_snapshot.py).
export const NUM_RE = /^[+-]?[\d.,]+(?:[eE][+-]?\d+)?$/;

// A value "looks like an ISO date" if it starts with YYYY-MM (bare date,
// datetime, or bare month). With a numeric target (bare year, e.g. `> 2020`), ISO dates match via
// lexicographic comparison (chronological in ASCII) but arbitrary text ("foo")
// does NOT. Shared by the 3 engines; parity with the backend's `_ISO_DATE_RE`.
export const ISO_DATE_RE = /^\d{4}-\d{2}/;

// Exported so that rollupUtils (percent_checked) counts checkboxes with the
// SAME truthiness logic as the filters.
export function asBool(x) {
    if (x === true) return true;
    if (x === false || x === null || x === undefined || x === '') return false;
    if (typeof x === 'number') return x !== 0;
    return TRUTHY.has(String(x).trim().toLowerCase());
}

// Parses a numeric value tolerant of the LOCAL decimal (comma): "0,25" → 0.25.
// `parseFloat` stops at the comma ("0,25" → 0), so a number field with
// values in Catalan/Castilian format was being sorted and filtered incorrectly (all the
// "0,xx" values tied at 0). Only the UNAMBIGUOUS case (a single comma, with no
// thousands); the rest falls back to parseFloat (compatible with "0.25", "5", "12.5"…).
// Exported so that DbViewEmbed.applyFilter compares numbers with the SAME
// semantics (parity between the main view's filter and the embedded one's).
export function parseNumericValue(s) {
    const t = String(s).trim();
    return /^-?\d+,\d+$/.test(t) ? Number(t.replace(',', '.')) : parseFloat(t);
}

/**
 * Evaluates a SINGLE filter rule `{ field, operator, value }` against an item.
 * Extracted from `matchesFilters` so both the flat list and the nested
 * filter-tree evaluator (`matchesFilterNode`) share the exact same per-rule
 * semantics — 1:1 parity with the backend snapshot engine
 * (view_snapshot.apply_filter) and the embedded-view one (DbViewEmbed.applyFilter).
 *
 * @param {Object} item - The object to filter (vault page or graph node)
 * @param {Object} filter - A single rule { field, operator, value }
 * @returns {boolean}
 */
export function matchesRule(item, filter) {
    if (!filter || !filter.field) return true;
    // Get the field's value (supports special 'title' or metadata)
    const rawVal = filter.field === 'title'
        ? (item.title || item.label || '')
        : ((item.metadata || {})[filter.field] ?? (item[filter.field] ?? ''));

    // Normalizes the value to an array of strings —1:1 parity with the
    // backend's snapshot engine (view_snapshot.apply_filter) and the one for
    // embedded views (DbViewEmbed.applyFilter)—. A multi_select field
    // (or a multi-value relation) arrives as an ARRAY: treating it as a
    // single string (`String(['a','b'])` → "a,b") made `equals` never
    // match (the main view was hiding rows that DID contain the value) and
    // made `not_equals` ALWAYS match. We compare by membership, in lowercase
    // (case-insensitive, consistent with the rest of the filter).
    const arr = Array.isArray(rawVal)
        ? rawVal.map(x => String(x))
        : (rawVal === null || rawVal === undefined || rawVal === '' ? [] : [String(rawVal)]);
    const arrLower = arr.map(s => s.toLowerCase());
    const filterVal = String(filter.value || '').toLowerCase();

    switch (filter.operator) {
        // When the filter value is boolean (checkbox: "true"/"false"),
        // we compare by truthiness —not by string— so that a field with no value
        // counts as "unchecked" and matches "false".
        case 'equals':
            if (filterVal === 'true' || filterVal === 'false') return asBool(rawVal) === (filterVal === 'true');
            return arrLower.includes(filterVal);
        case 'not_equals':
            if (filterVal === 'true' || filterVal === 'false') return asBool(rawVal) !== (filterVal === 'true');
            return !arrLower.includes(filterVal);
        case 'contains': return arrLower.some(x => x.includes(filterVal));
        case 'not_contains': return !arrLower.some(x => x.includes(filterVal));
        case 'is_empty': return arr.length === 0;
        case 'is_not_empty': return arr.length > 0;
        // greater/less than: if BOTH (value and filter) are pure numbers
        // (NUM_RE, which EXCLUDES "YYYY-MM-DD" dates), numeric comparison
        // with `parseNumericValue` ('12,5' → 12.5, comma decimal); otherwise,
        // lowercase STRING comparison. For ISO dates the
        // lexicographic order is chronological (parity with DbViewEmbed/backend).
        case 'greater_than':
        case 'less_than': {
            const gt = filter.operator === 'greater_than';
            const targetNum = NUM_RE.test(filterVal.trim());
            return arr.some((x, i) => {
                const xt = x.trim();
                if (targetNum && NUM_RE.test(xt)) {
                    const n1 = parseNumericValue(x), n2 = parseNumericValue(filterVal);
                    return gt ? n1 > n2 : n1 < n2;
                }
                // Numeric target (bare year) with a value that is NOT numeric: it only
                // matches if the value is an ISO date (`> 2020` against "2024-01-15",
                // lexicographic = chronological). Arbitrary text ("foo") does NOT match
                // a numeric threshold — it used to fall into this and diverge from the backend.
                if (targetNum && !ISO_DATE_RE.test(xt)) return false;
                const xl = arrLower[i];
                return gt ? xl > filterVal : xl < filterVal;
            });
        }
        default: return true;
    }
}

// A node is a GROUP (not a leaf rule) when it carries a `rules` array. A group
// combines its children with `conjunction` ('and' = every / 'or' = some).
// Shared shape across the 3 filter engines (matchesFilterNode here,
// DbViewEmbed.applyFilterNode, backend view_snapshot.apply_filter_node).
export function isFilterGroup(node) {
    return !!node && Array.isArray(node.rules);
}

/**
 * Recursively evaluates a filter NODE — either a leaf rule
 * `{ field, operator, value }` or a group `{ conjunction, rules: [...] }` whose
 * children may themselves be groups (arbitrary nesting, like Notion).
 *
 * An empty group (no rules) matches everything, so it never hides rows while
 * the user is still building the filter. 1:1 parity with the backend
 * (view_snapshot.apply_filter_node) and the embedded view (DbViewEmbed.applyFilterNode).
 *
 * @param {Object} item - The object to filter
 * @param {Object} node - A rule or a group
 * @returns {boolean}
 */
export function matchesFilterNode(item, node) {
    if (!node) return true;
    if (isFilterGroup(node)) {
        const rules = node.rules;
        if (!rules || rules.length === 0) return true;
        const useOr = String(node.conjunction || 'and').toLowerCase() === 'or';
        return useOr
            ? rules.some(child => matchesFilterNode(item, child))
            : rules.every(child => matchesFilterNode(item, child));
    }
    return matchesRule(item, node);
}

/**
 * Applies a flat list of filters to a page/node (AND of all rules). Kept for
 * back-compat with the many callers that pass `view.filters`; internally it is
 * just a root AND group evaluated by `matchesFilterNode`.
 *
 * @param {Object} item - The object to filter (vault page or graph node)
 * @param {Array} filters - List of filters [{ field, operator, value }]
 * @returns {boolean} - True if the object satisfies ALL filters
 */
export function matchesFilters(item, filters = []) {
    if (!filters || filters.length === 0) return true;
    return matchesFilterNode(item, { conjunction: 'and', rules: filters });
}

/**
 * Evaluates a whole VIEW against an item, preferring the nested `filterTree`
 * (complex AND/OR groups) and falling back to the legacy flat `filters` list
 * (AND) when no tree is present. Single entry point so every consumer picks the
 * complex filter up automatically without repeating the precedence logic.
 *
 * @param {Object} item - The object to filter
 * @param {Object} view - A view object ({ filterTree?, filters? })
 * @returns {boolean}
 */
export function viewMatchesFilters(item, view) {
    const tree = view && view.filterTree;
    if (isFilterGroup(tree)) return matchesFilterNode(item, tree);
    return matchesFilters(item, (view && view.filters) || []);
}

/**
 * Normalizes a value for sorting: strips punctuation and leading
 * symbols (¿ ? ¡ ! « » " ' - etc.) so that «¿Què és?» sorts
 * like «Què és» and isn't grouped at the top because of the opening mark.
 *
 * @param {*} value - The value to normalize
 * @returns {string} - The value without punctuation/leading symbols
 */
export function sortKey(value) {
    return String(value ?? '').replace(/^[\p{P}\p{S}\s]+/u, '');
}

/**
 * Single-field comparator for view sorting. SINGLE source of truth
 * so that the main view (useVaultViewData), embedded views
 * (DbViewEmbed.multiKeySort) and —ideally— the backend snapshot
 * (view_snapshot.multi_key_sort) sort EXACTLY the same way:
 *  - EMPTY values FOLLOW the direction (like Excel/Sheets): LAST in
 *    ascending, FIRST in descending. Without this, a sparsely
 *    populated column made empty rows float to the top in ascending
 *    order, but pinning them last in BOTH directions was surprising
 *    when toggling to descending.
 *  - if both values are NUMERIC, real numeric order (2 < 10, not "10" < "2").
 *  - otherwise, `localeCompare` with normalization (sortKey), locale 'ca' and
 *    'base' sensitivity (insensitive to accents/case).
 * The direction is applied to BOTH the empty and non-empty parts; the caller
 * must not negate it.
 *
 * @param {*} aRaw - field value of element A (scalar or array)
 * @param {*} bRaw - field value of element B
 * @param {string} direction - 'asc' (default) or 'desc'
 * @returns {number} negative if A goes before, positive if after, 0 if tied
 */
export function compareFieldValues(aRaw, bRaw, direction = 'asc') {
    const aVal = String(aRaw ?? '');
    const bVal = String(bRaw ?? '');
    const aEmpty = aVal.trim() === '';
    const bEmpty = bVal.trim() === '';
    if (aEmpty || bEmpty) {
        if (aEmpty && bEmpty) return 0;
        // Empty values FOLLOW the direction: LAST in asc, FIRST in desc
        // (Excel/Sheets convention). Both branches depend on `direction`.
        const emptyFirst = direction === 'desc';
        return aEmpty ? (emptyFirst ? -1 : 1) : (emptyFirst ? 1 : -1);
    }
    // We only treat the value as NUMERIC if the WHOLE string is a number
    // (NUM_RE, which EXCLUDES dates): `parseFloat`/`parseNumericValue` parse
    // PREFIXES ('2024-07-05' → 2024), and without this filter dates from the same
    // year compared as equal and DATE ordering failed. Dates and text
    // fall through to the string fallback. For numbers we use `parseNumericValue`
    // ('12,5' → 12.5, comma decimal; #505).
    const isNumeric = NUM_RE.test(aVal.trim()) && NUM_RE.test(bVal.trim());
    let cmp = isNumeric
        ? parseNumericValue(aVal) - parseNumericValue(bVal)
        : sortKey(aVal).localeCompare(sortKey(bVal), 'ca', { sensitivity: 'base' });
    if (direction === 'desc') cmp = -cmp;
    return cmp;
}

/**
 * Normalizes a text for search: lowercase and WITHOUT diacritics (NFD +
 * removal of combining marks). This way searching "merce"/"informacio"/
 * "franca" finds "Mercè"/"Informació"/"França" —as expected in a
 * Catalan/Castilian vault, where the user doesn't usually type the accents—. The cedilla
 * (ç→c) and the tilde (ñ→n) are also decomposed and removed.
 */
export const normalizeForSearch = (s) =>
    String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Applies a text search to the title and metadata.
 *
 * @param {Object} item - The object to search
 * @param {string} searchTerm - The search text
 * @returns {boolean} - True if the text is found in the object
 */
export function matchesSearch(item, searchTerm = '') {
    if (!searchTerm || !searchTerm.trim()) return true;

    const q = normalizeForSearch(searchTerm);
    const title = normalizeForSearch(item.title || item.label || '');
    if (title.includes(q)) return true;

    const metadata = item.metadata || {};
    return Object.values(metadata).some(v => normalizeForSearch(v).includes(q));
}
