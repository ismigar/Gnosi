import { describe, expect, it } from 'vitest';
import { resolveViewFilters } from '../records/model/schemaUtils';
import { requireFilterNodes } from './filterContracts';

describe('saved-view filter boundary', () => {
    it('keeps valid nodes, opaque values and extension fields by identity', () => {
        const opaque = { plugin: { nested: ['keep', { enabled: true }] } };
        const leaf = { field: 'custom', operator: 'equals', value: opaque, extension: opaque };
        const group = { conjunction: 'or', rules: [leaf, null, {}], extension: opaque };
        const filters = [group, leaf, undefined];
        expect(requireFilterNodes(filters)).toBe(filters);
        expect(requireFilterNodes(filters)[0]).toBe(group);
        expect(leaf.value).toBe(opaque);
    });

    it('accepts shared subtrees without mistaking them for cycles', () => {
        const leaf = { field: 'status', operator: 'equals', value: 'open' };
        const shared = { rules: [leaf] };
        const filters = [{ rules: [shared, shared] }];
        expect(requireFilterNodes(filters)).toBe(filters);
    });

    it.each([
        [{ field: 'status', value: 'open' }],
        { conditions: [{ field: 'status', value: 'open' }] },
    ])('consumes normalized legacy filter containers without dropping valid rules', filters => {
        const normalized = resolveViewFilters({ filters });
        expect(requireFilterNodes(normalized)).toBe(normalized);
        expect(normalized).toHaveLength(1);
    });

    it.each([
        { value: [true] },
        { value: ['invalid'] },
        { value: [{ field: ['status'] }] },
        { value: [{ operator: 1 }] },
        { value: [{ periodPart: {} }] },
        { value: [{ conjunction: 1, rules: [] }] },
        { value: [{ rules: [{ field: 1 }] }] },
    ])('rejects unsupported rule shapes instead of silently removing criteria: $value', ({ value }) => {
        expect(() => requireFilterNodes(value)).toThrow('Invalid saved-view filter structure');
    });

    it('rejects cyclic groups without recursive overflow or mutation', () => {
        const rules: unknown[] = [];
        const group = { rules };
        rules.push(group);
        expect(() => requireFilterNodes([group])).toThrow('Invalid saved-view filter structure');
        expect(rules[0]).toBe(group);
    });
});
