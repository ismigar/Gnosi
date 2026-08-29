import { describe, expect, it } from 'vitest';

import {
    clampIndex,
    coerceValueForField,
    computePasteRect,
    isComputedType,
    isPasteableType,
    parseClipboardMatrix,
    rangeBetween,
    sameCellValue,
    serializeCellForClipboard,
} from './cellGridUtils';


describe('cellGridUtils', () => {
    it('protects computed, file and title fields from bulk paste', () => {
        expect(isComputedType('formula')).toBe(true);
        expect(isComputedType('last_edited_time')).toBe(true);
        expect(isComputedType('text')).toBe(false);
        expect(isPasteableType('formula')).toBe(false);
        expect(isPasteableType('files')).toBe(false);
        expect(isPasteableType('title')).toBe(false);
        expect(isPasteableType('text')).toBe(true);
    });

    it('serializes rich cell values into readable clipboard text', () => {
        expect(serializeCellForClipboard(
            ['page-1', 'page-2'],
            'relation',
            { 'page-1': 'First', 'page-2': 'Second' },
        )).toBe('First, Second');
        expect(serializeCellForClipboard([
            { nom: 'Ada', cognom1: 'Lovelace' },
            { nom: 'Alan', cognom1: 'Turing' },
        ], 'autoria')).toBe('Ada Lovelace; Alan Turing');
        expect(serializeCellForClipboard(true, 'checkbox')).toBe('true');
        expect(serializeCellForClipboard(
            '2026-01-01/2026-01-03',
            'period',
        )).toBe('2026-01-01/2026-01-03');
    });

    it('parses cross-platform TSV and removes one spreadsheet terminator row', () => {
        expect(parseClipboardMatrix('A\tB\r\nC\tD\r\n')).toEqual([
            ['A', 'B'],
            ['C', 'D'],
        ]);
        expect(parseClipboardMatrix('')).toEqual([]);
        expect(parseClipboardMatrix(null)).toEqual([]);
    });

    it('coerces localized numbers and rejects ambiguous values', () => {
        expect(coerceValueForField('0,5', 'number')).toEqual({ value: 0.5 });
        expect(coerceValueForField('42', 'number')).toEqual({ value: 42 });
        expect(coerceValueForField('1,2,3', 'number')).toEqual({ skip: true });
        expect(coerceValueForField('', 'number')).toEqual({ value: '' });
    });

    it('coerces known checkbox labels and skips unknown labels', () => {
        expect(coerceValueForField('sí', 'checkbox')).toEqual({ value: true });
        expect(coerceValueForField('off', 'checkbox')).toEqual({ value: false });
        expect(coerceValueForField('', 'checkbox')).toEqual({ value: false });
        expect(coerceValueForField('perhaps', 'checkbox')).toEqual({ skip: true });
    });

    it('matches select and multi-select values by identifier or title', () => {
        const context = {
            options: ['todo', 'done'],
            idToTitle: { todo: 'To do', done: 'Completed' },
        };
        expect(coerceValueForField('Completed', 'status', context))
            .toEqual({ value: 'done' });
        expect(coerceValueForField('To do, done, To do', 'multi_select', context))
            .toEqual({ value: ['todo', 'done'] });
        expect(coerceValueForField('Unknown', 'select', context))
            .toEqual({ skip: true });
    });

    it('matches relations by id or case-insensitive title', () => {
        const context = {
            relatedNotes: [
                { id: 'page-1', title: 'First page' },
                { id: 'page-2', title: 'Second page' },
            ],
        };
        expect(coerceValueForField(
            'First page, page-2, First page',
            'relation',
            context,
        )).toEqual({ value: ['page-1', 'page-2'] });
        expect(coerceValueForField('Missing', 'relation', context))
            .toEqual({ skip: true });
    });

    it('preserves explicit calendar and datetime values', () => {
        expect(coerceValueForField(
            '2024-07-15T23:00:00+02:00',
            'date',
        )).toEqual({ value: '2024-07-15' });
        expect(coerceValueForField(
            '2024-07-15T09:00:00',
            'datetime',
        )).toEqual({ value: '2024-07-15T09:00:00' });
        expect(coerceValueForField(
            '2024-07-15/2024-07-16',
            'period',
        )).toEqual({ value: '2024-07-15/2024-07-16' });
        expect(coerceValueForField('invalid', 'period')).toEqual({ skip: true });
    });

    it('keeps structured authors and serializes ordinary fallback values', () => {
        const authors = [{ nom: 'Ada', cognom1: 'Lovelace' }];
        expect(coerceValueForField(authors, 'autoria')).toEqual({ value: authors });
        expect(coerceValueForField('Ada Lovelace', 'autoria'))
            .toEqual({ skip: true });
        expect(coerceValueForField(['a', 'b'], 'text'))
            .toEqual({ value: 'a, b' });
        expect(coerceValueForField(null, 'url')).toEqual({ value: '' });
    });

    it('compares scalar, array and object values without false changes', () => {
        expect(sameCellValue('a', 'a')).toBe(true);
        expect(sameCellValue(['a', 'b'], ['a', 'b'])).toBe(true);
        expect(sameCellValue(['a'], ['b'])).toBe(false);
        expect(sameCellValue({ a: 1 }, { a: 1 })).toBe(true);
        expect(sameCellValue({ a: 1 }, { a: 2 })).toBe(false);
    });

    it('calculates bounded cursor ranges and paste rectangles', () => {
        expect(rangeBetween(3, 1)).toEqual([1, 2, 3]);
        expect(clampIndex(-1, 5)).toBe(0);
        expect(clampIndex(8, 5)).toBe(4);
        expect(computePasteRect(2, 3, {
            r0: 1,
            c0: 2,
            r1: 1,
            c1: 2,
        }, 4, 4)).toEqual({ r0: 1, c0: 2, r1: 2, c1: 3 });
        expect(computePasteRect(2, 2, {
            r0: 0,
            c0: 0,
            r1: 3,
            c1: 3,
        }, 5, 5)).toEqual({ r0: 0, c0: 0, r1: 3, c1: 3 });
    });
});
