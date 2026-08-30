import { describe, expect, it } from 'vitest';
import { textValues } from './filterTextValues';
import { matchesSearch } from './vaultFilters';

describe('searchable metadata traversal', () => {
    it('ignores only cycle edges and retains searchable siblings without mutating input', () => {
        const cycle: Record<string, unknown> = { title: 'Mercè' };
        cycle.self = cycle;
        const value = { first: cycle, second: cycle, after: 'tail' };
        expect(textValues(value)).toEqual(['Mercè', 'Mercè', 'tail']);
        expect(matchesSearch({ title: 'Page', metadata: value }, 'merce')).toBe(true);
        expect(cycle.self).toBe(cycle);
        expect(value.first).toBe(value.second);
    });

    it('supports cyclic arrays and repeated noncyclic arrays in original order', () => {
        const cycle: unknown[] = ['first'];
        cycle.push(cycle, 'last');
        expect(textValues([cycle, cycle])).toEqual(['first', 'last', 'first', 'last']);
        expect(cycle[1]).toBe(cycle);
    });

    it('preserves scalar, empty and structured-author coercion', () => {
        const handler = () => 'extension';
        expect(textValues([null, undefined, '', 0, false, 4n, Symbol('test'), handler]))
            .toEqual(['0', 'false', '4', 'Symbol(test)', String(handler)]);
        const part = { toString() { return 'Mercè'; } };
        const author = { nom: part, cognom1: 'Rodoreda', cognom2: null, hidden: 'ignored' };
        expect(textValues(author)).toEqual(['Mercè Rodoreda']);
        expect(author.nom).toBe(part);
    });

    it('retains native getter errors and releases traversal state after failure', () => {
        const failure = new Error('extension getter failed');
        const value = { get nested(): never { throw failure; } };
        const ancestors = new Set<object>();
        expect(() => textValues(value, ancestors)).toThrow(failure);
        expect(ancestors.size).toBe(0);
    });
});
