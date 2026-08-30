import { describe, expect, it } from 'vitest';
import { decodePages, decodeView, decodeViews } from './decode';
import { cloneFilterNode, collectLeafRules, emptyFilterTree, flatAndRules, sanitizeFilterTree, treeFromSource } from './filter-tree';
import { readPinnedViews, writePinnedViews } from './pinned-views';
import { defineStorageKey, removeStorage, stringStorageCodec, writeStorage } from '../../../../shared/platform/browser-storage';
import { inputValue } from './input-value';

describe('PageViewModal persisted configuration models', () => {
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
                { field: 'status', operator: 'is_empty', value: null },
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
        expect(flatAndRules(sanitizeFilterTree(tree))).toEqual([{ field: 'date', operator: 'equals', value: 'today' }]);
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
        expect(inputValue(0)).toBe('');
        expect(inputValue(['alpha', 'beta'])).toBe('alpha,beta');
        expect(inputValue({ nom: 'Ana' })).toBe('[object Object]');
    });
});
