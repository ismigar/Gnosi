import { describe, expect, it } from 'vitest';
import { applyExposedFilters, exposedFilterEntries, sourceFilterTree } from './exposedFilters';
import { viewMatchesFilters } from './vaultFilters';

describe('temporary exposed filters', () => {
    it('preserves fixed page filters and nested OR semantics without changing saved values', () => {
        const tree = { conjunction: 'and', rules: [
            { field: 'project', operator: 'equals', value: 'project-a' },
            { conjunction: 'or', rules: [
                { field: 'status', operator: 'equals', value: 'Open', exposed: true },
                { field: 'status', operator: 'equals', value: 'Review', exposed: true },
            ] },
        ] };
        const keys = exposedFilterEntries(tree, {}).map(entry => entry.key);
        expect(keys).toEqual(['root.1.0', 'root.1.1']);
        const edited = applyExposedFilters(tree, { 'root.1.0': { enabled: true, value: 'Done' } });
        const matches = (project: string, status: string) => viewMatchesFilters({ metadata: { project, status } }, { filterTree: edited });
        expect(matches('project-a', 'Done')).toBe(true);
        expect(matches('project-a', 'Review')).toBe(true);
        expect(matches('project-a', 'Open')).toBe(false);
        expect(matches('project-b', 'Done')).toBe(false);
        expect(JSON.stringify(tree)).toContain('Open');
        expect(JSON.stringify(tree)).not.toContain('Done');
    });
    it('prunes disabled nested groups instead of matching everything in an OR', () => {
        const tree = { conjunction: 'or', rules: [
            { conjunction: 'and', rules: [{ field: 'status', operator: 'is_empty', exposed: true }] },
            { field: 'status', operator: 'equals', value: 'Review' },
        ] };
        const filterTree = applyExposedFilters(tree, { 'root.0.0': { enabled: false, value: null } });
        expect(viewMatchesFilters({ metadata: { status: 'Other' } }, { filterTree })).toBe(false);
        expect(viewMatchesFilters({ metadata: { status: 'Review' } }, { filterTree })).toBe(true);
    });
    it('keeps a saved filter-tree leaf authoritative over the legacy mirror', () => {
        const leaf = { field: 'status', operator: 'equals', value: 'Open', exposed: true };
        const tree = sourceFilterTree({ filterTree: leaf, filters: [{ field: 'status', operator: 'equals', value: 'Closed' }] });
        expect(tree.rules).toEqual([leaf]);
        expect(exposedFilterEntries(tree, {})).toHaveLength(1);
    });
    it('supports legacy single-rule sources', () => {
        expect(sourceFilterTree({ filter: { field: 'title', exposed: true } }).rules).toHaveLength(1);
    });
});
