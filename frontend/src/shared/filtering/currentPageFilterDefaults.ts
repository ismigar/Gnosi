import { isFilterGroup, type FilterNode } from './vaultFilters';

// These values belong to the record identity or its source table, not to a
// property inferred from the page containing an embedded view.
const RECORD_FIELDS = new Set(['title', 'id', 'table_id', 'database_table_id', 'database_id', 'is_template']);

/** Infer only current-page equalities required by every matching branch. */
export function currentPageFilterDefaults(node: FilterNode, pageId: string | null): Record<string, string> {
    if (!pageId || !node) return {};
    if (!isFilterGroup(node)) {
        return node.field && !RECORD_FIELDS.has(node.field) && node.operator === 'equals' && node.value === 'this'
            ? { [node.field]: pageId }
            : {};
    }
    const defaults = node.rules.map(rule => currentPageFilterDefaults(rule, pageId));
    if ((node.conjunction || 'and').toLowerCase() !== 'or') {
        return defaults.reduce((result, child) => ({ ...result, ...child }), {});
    }
    // An optional OR branch must not assign an unrelated project. A shared
    // equality is safe when every branch requires that same property.
    return Object.fromEntries(Object.entries(defaults[0] || {})
        .filter(([field, value]) => defaults.every(child => child[field] === value)));
}
