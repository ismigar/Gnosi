import { describe, expect, it } from 'vitest';
import { decodePages, decodeView, decodeViews } from './decode';
import { cloneFilterNode, collectLeafRules, emptyFilterTree, flatAndRules, sanitizeFilterTree, treeFromSource } from './filter-tree';
import { readPinnedViews, writePinnedViews } from './pinned-views';
import { defineStorageKey, removeStorage, stringStorageCodec, writeStorage } from '../../../../shared/platform/browser-storage';
import { inputValue } from './input-value';

describe('PageViewModal persisted configuration models', () => {
    it('restores embedded section names, view types, columns and legacy filters', () => {
        expect(decodeView({ heading: 'Reading notes', source_table_id: 'brain', type: 'db_view', view_type: 'gallery',
            visible_properties: ['title', 'Source'], filter: { field: 'Source', operator: 'equals', value: 'this' },
            cardSize: 'full', galleryPreview: 'content' })).toMatchObject({
            name: 'Reading notes', table_id: 'brain', type: 'gallery', visibleProperties: ['title', 'Source'],
            filters: [{ field: 'Source', operator: 'equals', value: 'this' }], cardSize: 'full', galleryPreview: 'content',
        });
    });
    it('preserves nested OR groups, filters empty nodes and keeps the legacy flat mirror honest', () => {
        const source = decodeView({
            filterTree: {
                conjunction: 'or', rules: [
                    { field: '', operator: 'equals', value: 'ignored' },
                    { conjunction: 'and', rules: [] },
                    { field: 'status', operator: 'is_empty', value: 'discarded', periodPart: 'end' },
                    { conjunction: 'and', rules: [{ field: 'owner', operator: 'equals', value: 'this' }] },
                ]
            }
        });
        const clean = sanitizeFilterTree(treeFromSource(source));
        expect(clean).toEqual({
            conjunction: 'or', rules: [
                { field: 'status', operator: 'is_empty', value: null, periodPart: 'end' },
                { conjunction: 'and', rules: [{ field: 'owner', operator: 'equals', value: 'this' }] },
            ]
        });
        expect(flatAndRules(clean)).toBeNull();
        expect(collectLeafRules(clean).map(rule => rule.field)).toEqual(['status', 'owner']);
    });

    it('clones legacy rules without mutating their extension keys', () => {
        const raw = { filters: [{ field: 'date', operator: 'equals', value: 'today', periodPart: 'end', extension: 42 }] };
        const tree = treeFromSource(decodeView(raw));
        const copy = cloneFilterNode(tree);
        copy.rules.push({ field: 'extra', operator: 'equals', value: 'x' });
        expect(tree.rules).toHaveLength(1);
        expect(tree.rules[0]).toMatchObject(raw.filters[0] || {});
        expect(flatAndRules(sanitizeFilterTree(tree))).toEqual([{ field: 'date', operator: 'equals', value: 'today', periodPart: 'end' }]);
        expect(sanitizeFilterTree(emptyFilterTree())).toEqual({ conjunction: 'and', rules: [] });
    });

    it('accepts legacy envelopes and preserves plugin options and composite columns', () => {
        const raw = Object.freeze({
            id: 'v1', name: 'Frozen', cover_field: 'art', plugin: { enabled: true },
            visibleProperties: ['title', { tableId: 'joined', fieldKey: 'rank', label: 'Rank' }],
            joins: [{ tableId: 'joined', type: 'left', leftField: 'id', rightField: 'owner' }],
            sorts: [{ field: 'rank', direction: 'desc' }]
        });
        const [view] = decodeViews({ views: Object.freeze([raw]) });
        expect(view).toMatchObject(raw);
        expect(view).not.toBe(raw);
        expect(decodeViews(null)).toEqual([]);
        expect(decodePages({ pages: [{ id: 'a' }] })).toEqual([{ id: 'a' }]);
        expect(decodePages({ items: [{ id: 'b' }] })).toEqual([{ id: 'b' }]);
    });

    it('retains the historic pinned-view key with malformed-storage fallback', () => {
        const key = defineStorageKey('gnosi_embed_pinned_test-page_default', stringStorageCodec);
        try {
            writeStorage(key, '{broken');
            expect(readPinnedViews('test-page', '')).toEqual(new Set());
            writeStorage(key, '[1]');
            expect(readPinnedViews('test-page', '')).toEqual(new Set());
            writePinnedViews('test-page', '', new Set(['one', 'two']));
            expect(readPinnedViews('test-page', '')).toEqual(new Set(['one', 'two']));
        } finally { removeStorage(key); }
    });

    it('preserves explicit nullable API fields and uninterpreted column labels', () => {
        const raw = {
            id: null, type: null, cardSize: null, is_main: null,
            visibleProperties: [{ tableId: null, fieldKey: 'title', label: null },
            { tableId: 'other', fieldKey: 'rank', label: { translated: 'Rank' } }]
        };
        expect(decodeView(raw)).toMatchObject(raw);
    });

    it('keeps DOM string coercion for the supported JSON filter values', () => {
        expect(inputValue(null)).toBe('');
        expect(inputValue(0)).toBe('0');
        expect(inputValue(false)).toBe('false');
        expect(inputValue(['alpha', 'beta'])).toBe('alpha,beta');
        expect(inputValue({ nom: 'Ana' })).toBe('[object Object]');
    });
});

it('keeps exposed controls, period boundaries, false and zero through serialization', () => {
    const tree = sanitizeFilterTree(treeFromSource({ filters: [
        { field: 'done', operator: 'equals', value: false, exposed: true },
        { field: 'amount', operator: 'equals', value: 0, exposed: true },
        { field: 'period', operator: 'equals', value: 'today', periodPart: 'end', exposed: true },
    ] }));
    const restored = decodeView(JSON.parse(JSON.stringify({ filterTree: tree })));
    expect(restored.filterTree).toEqual(tree);
    expect(collectLeafRules(restored.filterTree).map(rule => rule.value)).toEqual([false, 0, 'today']);
    expect(collectLeafRules(restored.filterTree).every(rule => rule.exposed)).toBe(true);
});
