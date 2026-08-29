/**
 * vaultFilters.ts
 * Shared filtering utilities for the Vault and the Graph.
 */
import {
    periodBoundary,
    type PeriodInput,
} from './projectPlanning';

type FilterPrimitive = string | number | bigint | boolean | null | undefined;
export type FilterValue =
    | FilterPrimitive
    | readonly FilterValue[]
    | { readonly [key: string]: FilterValue };

export interface FilterItem {
    [key: string]: FilterValue;
    label?: FilterPrimitive;
    metadata?: Readonly<Record<string, FilterValue>>;
    title?: FilterPrimitive;
}

export interface FilterRule {
    field?: string | null;
    operator?: string | null;
    periodPart?: string | null;
    value?: FilterValue;
}

export interface FilterGroup {
    conjunction?: string | null;
    rules: readonly FilterNode[];
}

export type FilterNode = FilterGroup | FilterRule | null | undefined;

interface FilterView { filterTree?: FilterNode; filters?: readonly FilterNode[]; }

interface StructuredAuthor { readonly [key: string]: FilterValue; cognom1?: FilterValue; cognom2?: FilterValue; nom?: FilterValue; }

type TextMatchMode = 'contains' | 'equals';
type AuthorKey = 'nom' | 'cognom1' | 'cognom2';

const AUTHOR_KEYS: readonly AuthorKey[] = ['nom', 'cognom1', 'cognom2'];

function isFilterValueArray(
    value: FilterValue,
): value is readonly FilterValue[] {
    return Array.isArray(value);
}

function stringifyFilterValue(value: FilterValue): string {
    return Reflect.apply(String, undefined, [value]);
}

function toPeriodInput(value: FilterValue): PeriodInput {
    return isFilterValueArray(value)
        ? value.map(stringifyFilterValue).join(',')
        : value;
}

function localToday(): string {
    const now = new Date();
    return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

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
export function asBool(x: FilterValue): boolean {
    if (x === true) return true;
    if (x === false || x === null || x === undefined || x === '') return false;
    if (typeof x === 'number') return x !== 0;
    return TRUTHY.has(stringifyFilterValue(x).trim().toLowerCase());
}

// Parses a numeric value tolerant of the LOCAL decimal (comma): "0,25" → 0.25.
// `parseFloat` stops at the comma ("0,25" → 0), so a number field with
// values in Catalan/Castilian format was being sorted and filtered incorrectly (all the
// "0,xx" values tied at 0). Only the UNAMBIGUOUS case (a single comma, with no
// thousands); the rest falls back to parseFloat (compatible with "0.25", "5", "12.5"…).
// Exported so that DbViewEmbed.applyFilter compares numbers with the SAME
// semantics (parity between the main view's filter and the embedded one's).
export function parseNumericValue(s: FilterValue): number {
    const t = stringifyFilterValue(s).trim();
    return /^-?\d+,\d+$/.test(t) ? Number(t.replace(',', '.')) : parseFloat(t);
}

const REGEX_LITERAL_RE = /^\/([\s\S]*)\/([a-z]*)$/i;
const REGEX_FLAGS_RE = /^[dgimsuvy]*$/;

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Matches user-entered text patterns consistently across searches and filters.
 * Plain text keeps the historical contains/equals semantics. `%` is a
 * SQL-style wildcard and `/pattern/flags` is treated as an explicit regular
 * expression. Invalid regular expressions safely fall back to plain text.
 */
export function matchesTextPattern(
    candidate: FilterValue,
    pattern: FilterValue,
    mode: TextMatchMode = 'contains',
): boolean {
    const source = normalizeForSearch(candidate);
    const rawPattern = stringifyFilterValue(pattern ?? '');
    const normalizedPattern = normalizeForSearch(rawPattern);
    if (!normalizedPattern) return true;

    const literal = rawPattern.match(REGEX_LITERAL_RE);
    const literalBody = literal?.[1];
    const literalFlags = literal?.[2];
    if (
        literalBody !== undefined
        && literalFlags !== undefined
        && REGEX_FLAGS_RE.test(literalFlags)
    ) {
        try {
            const normalizedBody = normalizeForSearch(literalBody);
            const flags = Array.from(
                new Set(`${literalFlags}i`.replace(/[gy]/g, '')),
            ).join('');
            return new RegExp(normalizedBody, flags).test(source);
        } catch {
            // Keep the filter usable while the user is typing an incomplete regex.
        }
    }

    if (normalizedPattern.includes('%')) {
        const wildcard = normalizedPattern
            .split('%')
            .map(escapeRegex)
            .join('.*');
        return new RegExp(`^${wildcard}$`, 'i').test(source);
    }
    return mode === 'equals'
        ? source === normalizedPattern
        : source.includes(normalizedPattern);
}

function isStructuredAuthor(value: FilterValue): value is StructuredAuthor {
    return value !== null
        && typeof value === 'object'
        && !isFilterValueArray(value)
        && ('nom' in value || 'cognom1' in value || 'cognom2' in value);
}

function textValues(value: FilterValue): string[] {
    if (value === null || value === undefined || value === '') return [];
    if (isFilterValueArray(value)) return value.flatMap(textValues);
    if (isStructuredAuthor(value)) {
        return [[value.nom, value.cognom1, value.cognom2]
            .map((part) => stringifyFilterValue(part ?? ''))
            .filter(Boolean)
            .join(' ')];
    }
    if (typeof value === 'object') return Object.values(value).flatMap(textValues);
    return [stringifyFilterValue(value)];
}

function matchesStructuredAuthorship(
    rawValue: FilterValue,
    filterValue: FilterValue,
    operator: string | null | undefined,
): boolean | null {
    if (!isStructuredAuthor(filterValue)) return null;
    const criteria = AUTHOR_KEYS
        .filter((key) => stringifyFilterValue(filterValue[key] || '').trim())
        .map((key): readonly [AuthorKey, FilterValue] => [
            key,
            filterValue[key],
        ]);
    if (!criteria.length) return true;
    const mode = operator === 'equals' || operator === 'not_equals' ? 'equals' : 'contains';
    const authors = isFilterValueArray(rawValue) ? rawValue : [rawValue];
    const positive = authors.some(author => {
        if (isStructuredAuthor(author)) {
            return criteria.every(([key, pattern]) => matchesTextPattern(author[key], pattern, mode));
        }
        // Legacy free-text authorship remains searchable until migration is complete.
        return criteria.every(([, pattern]) => matchesTextPattern(author, pattern, mode));
    });
    return operator === 'not_equals' || operator === 'not_contains' ? !positive : positive;
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
export function matchesRule(
    item: FilterItem,
    filter: FilterRule | null | undefined,
): boolean {
    if (!filter || !filter.field) return true;
    // Get the field's value (supports special 'title' or metadata)
    let rawVal = filter.field === 'title'
        ? (item.title || item.label || '')
        : ((item.metadata || {})[filter.field] ?? (item[filter.field] ?? ''));
    if (
        filter.periodPart
        || (
            rawVal
            && typeof rawVal === 'object'
            && !Array.isArray(rawVal)
            && 'start' in rawVal
        )
    ) {
        rawVal = periodBoundary(
            toPeriodInput(rawVal),
            filter.periodPart || 'start',
        );
    }

    const authorshipMatch = matchesStructuredAuthorship(rawVal, filter.value, filter.operator);
    if (authorshipMatch !== null) return authorshipMatch;

    // Normalizes the value to an array of strings —1:1 parity with the
    // backend's snapshot engine (view_snapshot.apply_filter) and the one for
    // embedded views (DbViewEmbed.applyFilter)—. A multi_select field
    // (or a multi-value relation) arrives as an ARRAY: treating it as a
    // single string (`String(['a','b'])` → "a,b") made `equals` never
    // match (the main view was hiding rows that DID contain the value) and
    // made `not_equals` ALWAYS match. We compare by membership, in lowercase
    // (case-insensitive, consistent with the rest of the filter).
    const arr = textValues(rawVal);
    const arrLower = arr.map(s => s.toLowerCase());
    // A multi-select filter can carry several selected options. Those options
    // match when any selected value belongs to the record's value array.
    const filterVals = (Array.isArray(filter.value) ? filter.value : [filter.value])
        .map(value => value === 'today' ? localToday() : String(value ?? ''))
        .map(value => value.toLowerCase())
        .filter(Boolean);
    const filterVal = filterVals[0] || '';

    switch (filter.operator) {
        // When the filter value is boolean (checkbox: "true"/"false"),
        // we compare by truthiness —not by string— so that a field with no value
        // counts as "unchecked" and matches "false".
        case 'equals':
            if (filterVal === 'true' || filterVal === 'false') return asBool(rawVal) === (filterVal === 'true');
            return filterVals.some(value => arr.some(x => matchesTextPattern(x, value, 'equals')));
        case 'not_equals':
            if (filterVal === 'true' || filterVal === 'false') return asBool(rawVal) !== (filterVal === 'true');
            return filterVals.every(value => !arr.some(x => matchesTextPattern(x, value, 'equals')));
        case 'contains': return filterVals.some(value => arr.some(x => matchesTextPattern(x, value, 'contains')));
        case 'not_contains': return filterVals.every(value => !arr.some(x => matchesTextPattern(x, value, 'contains')));
        case 'is_empty': return arr.length === 0;
        case 'is_not_empty': return arr.length > 0;
        // greater/less than: if BOTH (value and filter) are pure numbers
        // (NUM_RE, which EXCLUDES "YYYY-MM-DD" dates), numeric comparison
        // with `parseNumericValue` ('12,5' → 12.5, comma decimal); otherwise,
        // lowercase STRING comparison. For ISO dates the
        // lexicographic order is chronological (parity with DbViewEmbed/backend).
        case 'greater_than':
        case 'greater_than_or_equal':
        case 'less_than':
        case 'less_than_or_equal': {
            const isGt = filter.operator === 'greater_than' || filter.operator === 'greater_than_or_equal';
            const isEq = filter.operator === 'greater_than_or_equal' || filter.operator === 'less_than_or_equal';
            const targetNum = NUM_RE.test(filterVal.trim());
            return arr.some((x, i) => {
                const xt = x.trim();
                if (targetNum && NUM_RE.test(xt)) {
                    const n1 = parseNumericValue(x), n2 = parseNumericValue(filterVal);
                    if (isGt) return isEq ? n1 >= n2 : n1 > n2;
                    return isEq ? n1 <= n2 : n1 < n2;
                }
                // Numeric target (bare year) with a value that is NOT numeric: it only
                // matches if the value is an ISO date (`> 2020` against "2024-01-15",
                // lexicographic = chronological). Arbitrary text ("foo") does NOT match
                // a numeric threshold — it used to fall into this and diverge from the backend.
                if (targetNum && !ISO_DATE_RE.test(xt)) return false;
                const xl = arrLower.at(i) ?? '';
                if (isGt) return isEq ? xl >= filterVal : xl > filterVal;
                return isEq ? xl <= filterVal : xl < filterVal;
            });
        }
        default: return true;
    }
}

// A node is a GROUP (not a leaf rule) when it carries a `rules` array. A group
// combines its children with `conjunction` ('and' = every / 'or' = some).
// Shared shape across the 3 filter engines (matchesFilterNode here,
// DbViewEmbed.applyFilterNode, backend view_snapshot.apply_filter_node).
export function isFilterGroup(node: FilterNode): node is FilterGroup {
    return node !== null
        && node !== undefined
        && 'rules' in node
        && Array.isArray(node.rules);
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
export function matchesFilterNode(
    item: FilterItem,
    node: FilterNode,
): boolean {
    if (!node) return true;
    if (isFilterGroup(node)) {
        const rules = node.rules;
        if (rules.length === 0) return true;
        const useOr = (node.conjunction || 'and').toLowerCase() === 'or';
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
export function matchesFilters(
    item: FilterItem,
    filters: readonly FilterNode[] | null | undefined = [],
): boolean {
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
export function viewMatchesFilters(
    item: FilterItem,
    view: FilterView | null | undefined,
): boolean {
    const tree = view?.filterTree;
    if (isFilterGroup(tree)) return matchesFilterNode(item, tree);
    return matchesFilters(item, view?.filters || []);
}

/**
 * @language-example
 * Normalizes a value for sorting: strips punctuation and leading
 * symbols (¿ ? ¡ ! « » " ' - etc.) so that «¿Què és?» sorts
 * like «Què és» and isn't grouped at the top because of the opening mark.
 *
 * @param {*} value - The value to normalize
 * @returns {string} - The value without punctuation/leading symbols
 */
export function sortKey(value: FilterValue): string {
    return stringifyFilterValue(value ?? '')
        .replace(/^[\p{P}\p{S}\s]+/u, '');
}

/**
 * Single-field comparator for view sorting. SINGLE source of truth
 * so that the main view (useVaultViewData), embedded views
 * (DbViewEmbed.multiKeySort) and —ideally— the backend snapshot
 * (view_snapshot.multi_key_sort) sort EXACTLY the same way:
 *  - EMPTY values are always LAST, in both ascending and descending
 *    order. This matches Notion view sorting and prevents records without
 *    the primary property from preceding populated records.
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
export function compareFieldValues(
    aRaw: FilterValue,
    bRaw: FilterValue,
    direction = 'asc',
): number {
    const comparable = (raw: FilterValue): FilterValue => {
        if (
            raw
            && typeof raw === 'object'
            && !isFilterValueArray(raw)
        ) {
            if ('start' in raw) return raw.start || '';
            return raw.name ?? raw.title ?? '';
        }
        return raw ?? '';
    };
    const aVal = stringifyFilterValue(comparable(aRaw));
    const bVal = stringifyFilterValue(comparable(bRaw));
    const aEmpty = aVal.trim() === '';
    const bEmpty = bVal.trim() === '';
    if (aEmpty || bEmpty) {
        if (aEmpty && bEmpty) return 0;
        return aEmpty ? 1 : -1;
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
        : sortKey(aVal).localeCompare(sortKey(bVal), 'en', { sensitivity: 'base' });
    if (direction === 'desc') cmp = -cmp;
    return cmp;
}

/**
 * @language-example
 * Normalizes a text for search: lowercase and WITHOUT diacritics (NFD +
 * removal of combining marks). This way searching "merce"/"informacio"/
 * "franca" finds "Mercè"/"Informació"/"França" —as expected in a
 * Catalan/Castilian vault, where the user doesn't usually type the accents—. The cedilla
 * (ç→c) and the tilde (ñ→n) are also decomposed and removed.
 */
export const normalizeForSearch = (s: FilterValue): string =>
    stringifyFilterValue(s ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');

/**
 * Applies a text search to the title and metadata.
 *
 * @param {Object} item - The object to search
 * @param {string} searchTerm - The search text
 * @returns {boolean} - True if the text is found in the object
 */
export function matchesSearch(
    item: FilterItem,
    searchTerm: string | null | undefined = '',
): boolean {
    if (!searchTerm || !searchTerm.trim()) return true;

    if (matchesTextPattern(item.title || item.label || '', searchTerm, 'contains')) return true;

    const metadata = item.metadata || {};
    return Object.values(metadata).some(value => (
        textValues(value).some(text => matchesTextPattern(text, searchTerm, 'contains'))
    ));
}
