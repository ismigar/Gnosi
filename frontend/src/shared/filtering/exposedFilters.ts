import type { FilterGroup, FilterNode, FilterRule } from './vaultFilters';

export interface FilterSource {
    filterTree?: FilterNode;
    filters?: readonly FilterNode[];
    filter?: FilterRule;
}
export interface ExposedFilter { key: string; rule: FilterRule; enabled: boolean; }
export interface FilterOverride { enabled: boolean; value: unknown; }
export type FilterOverrides = Readonly<Record<string, FilterOverride>>;
const group = (node: FilterNode): node is FilterGroup => !!node && 'rules' in node;

export function sourceFilterTree(source: FilterSource): FilterGroup {
    if (group(source.filterTree)) return source.filterTree;
    if (source.filterTree?.field) return { conjunction: 'and', rules: [source.filterTree] };
    return { conjunction: 'and', rules: source.filters?.length ? source.filters : source.filter ? [source.filter] : [] };
}

/** Path keys distinguish repeated fields, including separate rules inside OR groups. */
export function exposedFilterEntries(tree: FilterGroup, overrides: FilterOverrides): ExposedFilter[] {
    const visit = (node: FilterNode, key: string): ExposedFilter[] => {
        if (!node) return [];
        if (group(node)) return node.rules.flatMap((child, index) => visit(child, `${key}.${String(index)}`));
        if (node.exposed !== true || !node.field) return [];
        const override = overrides[key];
        return [{ key, rule: override ? { ...node, value: override.value } : node, enabled: override?.enabled !== false }];
    };
    return visit(tree, 'root');
}

export function applyExposedFilters(tree: FilterGroup, overrides: FilterOverrides): FilterGroup {
    if (Object.keys(overrides).length === 0) return tree;
    const visit = (node: FilterNode, key: string): FilterNode => {
        if (!node) return node;
        if (group(node)) {
            const children = node.rules.map((child, index) => visit(child, `${key}.${String(index)}`));
            if (children.every((child, index) => child === node.rules[index])) return node;
            const rules = children.filter(Boolean);
            // Removed groups must not become an always-true branch of an OR.
            return rules.length ? { ...node, rules } : undefined;
        }
        const override = node.exposed === true ? overrides[key] : undefined;
        return override ? (override.enabled ? { ...node, value: override.value } : undefined) : node;
    };
    const result = visit(tree, 'root');
    return group(result) ? result : { conjunction: 'and', rules: [] };
}
