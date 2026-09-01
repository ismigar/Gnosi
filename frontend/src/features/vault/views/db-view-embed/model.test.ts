import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineStorageKey, removeStorage, stringStorageCodec } from '../../../../shared/platform/browser-storage';
import { applyFilterNode, metaValueForField, multiKeySort, searchRows } from './filter-model';
import { applyClientJoins, normalizeVisibleColumns } from './joins';
import { byTableCache, byTableGet, byTableSet } from './cache';
import { decodeRow, decodeView } from './decode';
import { encodePresets, importPresets, pinnedKey, readPinned, readPresets, selectedKey, writeText } from './preferences';
import type { EmbedRow } from './types';

const row = (id: string, metadata: EmbedRow['metadata'] = {}, title = id): EmbedRow => ({ id, title, metadata });
afterEach(() => {
    byTableCache.clear();
    vi.useRealTimers();
    for (const key of [pinnedKey('page', 'anchor'), 'test-presets']) removeStorage(defineStorageKey(key, stringStorageCodec));
});

describe('embed filtering and stable ordering', () => {
    it('resolves this and emoji-prefixed metadata inside nested AND/OR groups', () => {
        const record = row('a', { '👤 Parent': 'page', status: 'done' }, 'Mercè');
        expect(metaValueForField(record.metadata, 'parent')).toBe('page');
        expect(applyFilterNode(record, 'page', {
            conjunction: 'and', rules: [
                { field: 'parent', operator: 'equals', value: 'this' },
                { conjunction: 'or', rules: [{ field: 'title', operator: 'contains', value: 'merce' }, { field: 'status', operator: 'equals', value: 'open' }] },
            ]
        })).toBe(true);
        expect(applyFilterNode(record, 'other', { field: 'parent', operator: 'equals', value: 'this' })).toBe(false);
        expect(applyFilterNode(record, 'page', { rules: [] })).toBe(true);
    });
    it('sorts numeric values, secondary keys and missing metadata without mutation', () => {
        const rows = [row('z', { score: 10 }), row('b', { score: 2 }), row('a', { score: 2 }), row('empty')];
        expect(multiKeySort(rows, [{ field: 'score' }, { field: 'title' }]).map(r => r.id)).toEqual(['a', 'b', 'z', 'empty']);
        expect(rows[0]?.id).toBe('z');
        expect(multiKeySort(rows, []).map(r => r.id)).toEqual(['a', 'b', 'empty', 'z']);
    });
    it('searches all metadata with accent-insensitive weighted concepts', () => {
        const rows = [row('tag', { tags: ['Mercè', null, 'poesia'] }, 'Notes'), row('title', { hidden: 'poesia' }, 'Mercè'), row('none')];
        expect(searchRows(rows, 'merce poesia').map(r => r.id)).toEqual(['title', 'tag']);
        expect(searchRows(rows, '')).toBe(rows);
        expect(searchRows(rows, 'null')).toEqual([]);
        expect(searchRows(rows, 'a')).toEqual([]);
    });
});

describe('multi-table joins', () => {
    const base = [row('a', { keys: ['x', 'y'], shared: 'left' }), row('b', { keys: 'missing' })];
    const right = [row('r1', { code: 'x', shared: 'right', extra: 1 }), row('r2', { code: 'y', extra: 2 }), row('r3', { code: 'other' })];
    it('duplicates matched rows and retains base metadata and qualified joined fields', async () => {
        const load = vi.fn<(id: string) => Promise<EmbedRow[]>>().mockResolvedValue(right);
        const result = await applyClientJoins(base, [{ tableId: 'right', leftField: 'keys', rightField: 'code' }], load);
        expect(result.map(r => r.id)).toEqual(['a', 'a']);
        expect(result[0]?.metadata).toEqual({ keys: ['x', 'y'], shared: 'left', code: 'x', extra: 1, '_join:right': [right[0]?.metadata] });
        expect(base[0]?.metadata).not.toHaveProperty('extra');
        expect(load).toHaveBeenCalledWith('right');
    });
    it('preserves unmatched left rows and emits unmatched right rows with original ids', async () => {
        const join = { tableId: 'right', leftField: 'keys', rightField: 'code' };
        const left = await applyClientJoins(base, [{ ...join, type: 'left' }], () => Promise.resolve(right));
        expect(left.at(-1)?.metadata['_join:right']).toEqual([]);
        const joined = await applyClientJoins(base, [{ ...join, type: 'right' }], () => Promise.resolve(right));
        expect(joined.map(r => r.id)).toEqual(['a', 'a', 'r3']);
        expect(joined.at(-1)?.metadata).toEqual({ '_join:right': [right[2]?.metadata] });
    });
    it('skips incomplete joins and preserves composite column labels', async () => {
        const load = vi.fn<(id: string) => Promise<EmbedRow[]>>();
        expect(await applyClientJoins(base, [], load)).toBe(base);
        await applyClientJoins(base, [{ tableId: 'right' }], load);
        expect(load).not.toHaveBeenCalled();
        expect(normalizeVisibleColumns(['title', { tableId: 'right', fieldKey: 'code', label: 'Codi' }], 'base')).toEqual([{ tableId: 'base', fieldKey: 'title' }, { tableId: 'right', fieldKey: 'code', label: 'Codi' }]);
        expect(normalizeVisibleColumns([], 'base')).toEqual([{ tableId: 'base', fieldKey: 'title' }]);
    });
});

describe('portable preferences and caches', () => {
    it('keeps exact keys, tolerates corrupt JSON and decodes pinned ids', () => {
        expect(selectedKey('page', 'anchor')).toBe('gnosi_embed_view_page_anchor');
        writeText(pinnedKey('page', 'anchor'), '{broken');
        expect([...readPinned('page', 'anchor')]).toEqual([]);
        writeText(pinnedKey('page', 'anchor'), '["tab", "tab"]');
        expect([...readPinned('page', 'anchor')]).toEqual(['tab']);
        writeText('test-presets', 'invalid');
        expect(readPresets('test-presets')).toEqual([]);
    });
    it('round-trips Unicode presets in the historic URL format and keeps only five', () => {
        const presets = Array.from({ length: 6 }, (_, i) => ({ id: String(i), label: `Mercè 📚 ${String(i)}`, activeViewId: 'tab', density: 'compact' }));
        const url = encodePresets(presets, 'https://example.invalid/vault?x=1#old');
        expect(url).toContain('/vault?x=1#gnosi-view-presets=');
        expect(importPresets(url, 42)).toEqual(presets.slice(1).map((preset, i) => ({ ...preset, id: `42-${String(i)}` })));
        expect(importPresets(JSON.stringify(presets), 42)).toHaveLength(5);
        expect(() => importPresets('{}')).toThrow('invalid preset payload');
    });
    it('expires after five minutes, bounds the cache and refreshes FIFO insertion', () => {
        vi.useFakeTimers(); vi.setSystemTime(1000);
        const rows = [row('a')]; byTableSet('a', rows);
        expect(byTableGet('a')).toBe(rows);
        vi.setSystemTime(301000); expect(byTableGet('a')).toBe(rows);
        vi.setSystemTime(301001); expect(byTableGet('a')).toBeNull();
        for (let i = 0;i < 32;i++) byTableSet(String(i), rows);
        byTableSet('0', rows); byTableSet('32', rows);
        expect(byTableCache.size).toBe(32);
        expect(byTableGet('1')).toBeNull(); expect(byTableGet('0')).toBe(rows);
    });
    it('retains plugin data, legacy aliases, joins without type and nested filters', () => {
        const value = decodeView({ id: 'view', plugin: { token: 'fake' }, row_height: 'tall', visible_properties: [{ tableId: 't', fieldKey: 'title' }], joins: [{ tableId: 't', leftField: 'x', rightField: 'y' }], filterTree: { conjunction: 'or', rules: [{ field: 'title', value: 'x' }] } });
        expect(value.plugin).toEqual({ token: 'fake' }); expect(value.row_height).toBe('tall');
        expect(value.joins).toHaveLength(1); expect(value.filterTree?.rules).toHaveLength(1);
        expect(JSON.parse(JSON.stringify(decodeView({ groupBy: null, group_by: null })))).toMatchObject({ groupBy: null, group_by: null });
        expect(decodeRow({ id: 'a', title: 'A', created: 'today', metadata: { nested: { k: ['a', 2] } } })).toMatchObject({ created: 'today', metadata: { nested: { k: ['a', 2] } } });
    });
});
