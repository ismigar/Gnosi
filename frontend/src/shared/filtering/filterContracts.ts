import type { FilterNode } from './vaultFilters';

function optionalText(value: unknown): boolean {
    return value == null || typeof value === 'string';
}

function isFilterNode(value: unknown, ancestors: Set<object>): value is FilterNode {
    if (value == null) return true;
    if (typeof value !== 'object' || Array.isArray(value) || ancestors.has(value)) return false;
    if ('rules' in value && Array.isArray(value.rules)) {
        if ('conjunction' in value && !optionalText(value.conjunction)) return false;
        ancestors.add(value);
        const children: readonly unknown[] = value.rules;
        const valid = children.every(child => isFilterNode(child, ancestors));
        ancestors.delete(value);
        return valid;
    }
    return (!('field' in value) || optionalText(value.field))
        && (!('operator' in value) || optionalText(value.operator))
        && (!('periodPart' in value) || optionalText(value.periodPart));
}

/** Keep valid filter nodes and extension values by identity; never omit a bad rule. */
export function requireFilterNodes(value: readonly unknown[]): readonly FilterNode[] {
    if (value.every((node): node is FilterNode => isFilterNode(node, new Set()))) return value;
    throw new TypeError('Invalid saved-view filter structure; reload or repair the view configuration.');
}
