import { compareFieldValues, matchesRule, normalizeForSearch, type FilterNode, type FilterRule, type FilterValue, type FilterGroup } from '../../../utils/vaultFilters';
import { isFilterGroup, legacyText } from './decode';
import type { EmbedRow, Metadata } from './types';
import type { ViewSort } from '../page-view-modal/types';
export function normFieldKey(name: unknown) {
    return legacyText(name ?? '').replace(/^[^\p{L}\p{N}_]+/u, '').trim().toLowerCase();
}
export function metaValueForField(meta: Metadata | undefined, field: string): FilterValue {
    if (!meta) return undefined;
    if (field in meta) return meta[field];
    const nf = normFieldKey(field);
    if (!nf) return undefined;
    for (const k of Object.keys(meta)) {
        if (normFieldKey(k) === nf) return meta[k];
    }
    return undefined;
}

export function applyFilter(row: EmbedRow, pageId: string | null, f: FilterRule | null | undefined): boolean {
    if (!f?.field) return true;
    const raw = f.value === 'this' ? pageId : f.value;
    // `title` lives in the ROW, not in metadata (parity with matchesFilters):
    // without the special case, a filter by title —the default field of the
    // modal— emptied the embedded view while the table tab filtered correctly.
    const value = f.field === 'title'
        ? (row.title || '')
        : metaValueForField(row.metadata, f.field);
    const normalizedRow = f.field === 'title'
        ? { title: row.title || '', metadata: {} }
        : { title: row.title || '', metadata: { [f.field]: value } };
    return matchesRule(normalizedRow, { ...f, value: raw });
}
export function applyFilterNode(row: EmbedRow, pageId: string | null, node: FilterNode): boolean {
    if (!node) return true;
    if (isFilterGroup(node)) {
        const rules = node.rules;
        if (rules.length === 0) return true;
        const useOr = (node.conjunction || 'and').toLowerCase() === 'or';
        return useOr
            ? rules.some(child => applyFilterNode(row, pageId, child))
            : rules.every(child => applyFilterNode(row, pageId, child));
    }
    return applyFilter(row, pageId, node);
}

export function multiKeySort(rows: readonly EmbedRow[], sorts: readonly ViewSort[]): EmbedRow[] {
    // Comparator shared with the main view (vaultFilters.compareFieldValues):
    // empties last, numeric order for numbers, and normalized localeCompare for
    // the rest. It used to sort by pure string (`localeCompare`), so that
    // numbers came out lexicographic ("10" before "2") and empty values floated to the
    // top → the embedded view diverged from the main table.
    if (sorts.length === 0) {
        return [...rows].sort((a, b) => compareFieldValues(a.title, b.title, 'asc'));
    }
    // `title` is in the row; for everything else, a tolerant key into metadata with
    // fallback to the top-level field (last_modified/created) — parity with the
    // comparator of the main view (useVaultViewData).
    const sortValOf = (r: EmbedRow, field: string) => field === 'title'
        ? (r.title || '')
        : (metaValueForField(r.metadata, field) ?? r[field]);
    const result = [...rows];
    for (let i = sorts.length - 1;i >= 0;i--) {
        const current = sorts[i];
        if (!current) continue;
        const { field, direction = 'asc' } = current;
        if (!field) continue;
        result.sort((a, b) => compareFieldValues(sortValOf(a, field), sortValOf(b, field), direction));
    }
    return result;
}
export function countRules(node: FilterGroup): number {
    return node.rules.reduce((count, rule) => count + (isFilterGroup(rule) ? countRules(rule) : 1), 0);
}
export function searchRows(allRows: EmbedRow[], searchTerm: string): EmbedRow[] {
    const q = normalizeForSearch(searchTerm.trim());
    if (!q) return allRows;
    // Matching individual concepts keeps searches useful when the user writes a
    // natural phrase whose words are distributed between the title, tags and body.
    // It remains completely local: no request, index, or user data leaves the vault.
    const terms = q.split(/\s+/).filter((term) => term.length > 1);
    return allRows.map((record) => {
        const title = normalizeForSearch(record.title || '');
        const metadata = Object.values(record.metadata).map((value) => Array.isArray(value) ? value.map(item => legacyText(item ?? '')).join(' ') : legacyText(value ?? '')).join(' ');
        const haystack = `${title} ${normalizeForSearch(metadata)}`;
        const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0) + (title.includes(term) ? 2 : 0), 0);
        return { record, score };
    }).filter(({ score }) => score > 0).sort((left, right) => right.score - left.score).map(({ record }) => record);
}
