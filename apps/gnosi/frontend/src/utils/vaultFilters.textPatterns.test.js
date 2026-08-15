import { describe, expect, it } from 'vitest';

import { matchesRule, matchesSearch, matchesTextPattern } from './vaultFilters';

describe('text patterns', () => {
    it('supports SQL-style percent wildcards and explicit regular expressions', () => {
        expect(matchesTextPattern('Ismael García Fernández', 'Ismael%Fernandez')).toBe(true);
        expect(matchesTextPattern('Ismael García Fernández', '%Garcia%')).toBe(true);
        expect(matchesTextPattern('Ismael García Fernández', '/^ismael\\s+garc.*fernandez$/i')).toBe(true);
        expect(matchesTextPattern('Ismael García Fernández', 'Joan%')).toBe(false);
    });

    it('keeps plain contains and equals behavior', () => {
        expect(matchesTextPattern('Cultura de pau', 'cultura')).toBe(true);
        expect(matchesTextPattern('Cultura de pau', 'cultura', 'equals')).toBe(false);
        expect(matchesTextPattern('Cultura', 'cultura', 'equals')).toBe(true);
    });
});

describe('structured authorship filters', () => {
    const item = {
        metadata: {
            'Autoría': [
                { nom: 'Ismael', cognom1: 'García', cognom2: 'Fernández' },
                { nom: 'Maria', cognom1: 'Serra', cognom2: 'Pons' },
            ],
        },
    };

    it('matches by first name, either surname, or their combination', () => {
        expect(matchesRule(item, {
            field: 'Autoría', operator: 'contains', value: { nom: 'Ism%', cognom1: '', cognom2: '' },
        })).toBe(true);
        expect(matchesRule(item, {
            field: 'Autoría', operator: 'equals', value: { nom: '', cognom1: 'García', cognom2: 'Fernández' },
        })).toBe(true);
        expect(matchesRule(item, {
            field: 'Autoría', operator: 'contains', value: { nom: '/^maria$/i', cognom1: 'Ser%', cognom2: '' },
        })).toBe(true);
    });

    it('requires supplied components to belong to the same author', () => {
        expect(matchesRule(item, {
            field: 'Autoría', operator: 'contains', value: { nom: 'Ismael', cognom1: 'Serra', cognom2: '' },
        })).toBe(false);
    });

    it('searches the human-readable name inside structured metadata', () => {
        expect(matchesSearch(item, '%Garcia Fernandez')).toBe(true);
        expect(matchesSearch(item, '/maria\\s+serra/i')).toBe(true);
    });
});
