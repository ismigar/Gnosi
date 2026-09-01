import type { FilterGroup, FilterNode, FilterRule, ViewConfig } from './types';
import { NO_VALUE_OPS } from './constants';

export const isFilterGroup = (node: FilterNode | null | undefined): node is FilterGroup =>
    !!node && Array.isArray(node.rules);
export const emptyFilterTree = (): FilterGroup => ({ conjunction: 'and', rules: [] });

export function treeFromSource(src?: ViewConfig | null): FilterGroup {
    if (isFilterGroup(src?.filterTree)) return cloneFilterNode(src.filterTree);
    const flat = Array.isArray(src?.filters) ? src.filters : [];
    return { conjunction: 'and', rules: flat.map(f => ({ ...f })) };
}

export function cloneFilterNode(node: FilterGroup): FilterGroup;
export function cloneFilterNode(node: FilterNode): FilterNode;
export function cloneFilterNode(node: FilterNode): FilterNode {
    if (isFilterGroup(node)) {
        return { conjunction: node.conjunction === 'or' ? 'or' : 'and', rules: node.rules.map(cloneFilterNode) };
    }
    return { ...node };
}

export function collectLeafRules(node: FilterNode | null | undefined): FilterRule[] {
    if (!node) return [];
    if (isFilterGroup(node)) return node.rules.flatMap(collectLeafRules);
    return node.field ? [node] : [];
}

export function sanitizeFilterTree(node: FilterGroup): FilterGroup;
export function sanitizeFilterTree(node: FilterNode, isRoot: boolean): FilterNode | null;
export function sanitizeFilterTree(node: FilterNode, isRoot = true): FilterNode | null {
    if (isFilterGroup(node)) {
        const rules = node.rules.map(child => sanitizeFilterTree(child, false))
            .filter(child => child !== null);
        const group = { conjunction: node.conjunction === 'or' ? 'or' : 'and', rules };
        return !isRoot && rules.length === 0 ? null : group;
    }
    if (!node.field) return null;
    // Keep the historical persisted shape: periodPart and extension keys are
    // editor-only here, while filters in loaded state retain their extra keys.
    return {
        field: node.field, operator: node.operator || 'equals',
        value: NO_VALUE_OPS.includes(node.operator) ? null : (node.value || '')
    };
}

export function flatAndRules(tree: FilterGroup): FilterRule[] | null {
    if (tree.conjunction !== 'and' || tree.rules.some(isFilterGroup)) return null;
    return tree.rules.filter((rule): rule is FilterRule => !isFilterGroup(rule));
}
