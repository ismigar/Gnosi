import { describe, expect, it } from 'vitest';
import {
    asBool, compareFieldValues, matchesRule, matchesSearch,
    matchesTextPattern, parseNumericValue, type FilterItem,
} from './vaultFilters';

describe('opaque Vault metadata at shared filter boundaries', () => {
    const nested = { plugin: { authors: [{ nom: 'Mercè', cognom1: 'Rodoreda' }], flags: [false, true] } };
    const item: FilterItem = { title: 'Document', metadata: { extension: nested } };

    it('searches nested plugin content without rewriting the metadata', () => {
        expect(matchesSearch(item, 'rodoreda')).toBe(true);
        expect(matchesSearch(item, 'missing')).toBe(false);
        expect(item.metadata?.extension).toBe(nested);
    });

    it('retains structured authorship matching and multi-value membership', () => {
        const author = { nom: 'Mercè', cognom1: 'Rodoreda', extension: nested };
        expect(matchesRule({ metadata: { authors: [author] } }, {
            field: 'authors', operator: 'contains', value: { cognom1: 'rodo' },
        })).toBe(true);
        expect(matchesRule({ metadata: { categories: ['a', 'b'] } }, {
            field: 'categories', operator: 'equals', value: ['c', 'b'],
        })).toBe(true);
        expect(author.extension).toBe(nested);
    });

    it('keeps named-object and period sorting with empty values last', () => {
        expect(compareFieldValues({ name: '2', extension: nested }, { name: '10' })).toBeLessThan(0);
        expect(compareFieldValues({ start: '2025-01-01' }, { start: '2026-01-01' })).toBeLessThan(0);
        expect(compareFieldValues({}, { name: 'value' }, 'desc')).toBeGreaterThan(0);
    });

    it('preserves legacy coercion at boolean, numeric and text boundaries', () => {
        const truthy: unknown = { toString: () => 'yes' };
        const number: unknown = { toString: () => '12,5' };
        expect(asBool(truthy)).toBe(true);
        expect(asBool({})).toBe(false);
        expect(parseNumericValue(number)).toBe(12.5);
        expect(matchesTextPattern(['Mercè', 'Rodoreda'], 'rodoreda', 'contains')).toBe(true);
    });

    it('accepts absent/null metadata while leaving the original page untouched', () => {
        const nullPage = { id: 'empty', title: 'Empty', metadata: null };
        expect(matchesSearch(nullPage, 'empty')).toBe(true);
        expect(matchesSearch(nullPage, 'absent')).toBe(false);
        expect(matchesRule(nullPage, { field: 'missing', operator: 'is_empty' })).toBe(true);
        expect(nullPage.metadata).toBeNull();
    });
});
