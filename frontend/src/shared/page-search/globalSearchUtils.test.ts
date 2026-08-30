import { describe, expect, it, vi } from 'vitest';

import {
    buildTagFieldsByTable,
    getSearchNoteTags,
    isGlobalSearchShortcut,
    mergeGlobalSearchNotes,
    searchGlobalNotes,
    splitSearchTags,
} from './globalSearchUtils';

describe('global search utilities', () => {
    it('uses Option/Alt+K without intercepting the editor link shortcut', () => {
        expect(isGlobalSearchShortcut({
            altKey: true,
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            code: 'KeyK',
            key: '˚',
        })).toBe(true);
        expect(isGlobalSearchShortcut({
            altKey: false,
            ctrlKey: false,
            metaKey: true,
            shiftKey: false,
            code: 'KeyK',
            key: 'k',
        })).toBe(false);
    });

    it('supplements a partial page snapshot from the canonical title index', () => {
        const existing = { id: 'page-1', title: 'Existing page', metadata: { icon: '📄' } };

        expect(mergeGlobalSearchNotes([existing], {
            'page-1': 'Stale index title',
            'page-2': 'Indexed-only page',
        })).toEqual([
            existing,
            { id: 'page-2', title: 'Indexed-only page', metadata: {}, folder: '' },
        ]);
    });

    it('ranks direct titles ahead of tag-only matches before applying the limit', () => {
        const notes = [
            { id: 'tag-1', title: 'Unrelated recent page', metadata: { tags: ['methodology'] } },
            { id: 'tag-2', title: 'Another recent page', metadata: { tags: ['methodology'] } },
            { id: 'title', title: 'Methodology handbook', metadata: {} },
        ];

        expect(searchGlobalNotes({
            notes,
            query: 'methodology',
            limit: 1,
        })).toEqual([notes[2]]);
    });

    it('finds a page by alias as well as by its canonical title', () => {
        const note = { id: 'page-1', title: 'Canonical title', metadata: {} };

        expect(searchGlobalNotes({
            notes: [note],
            query: 'working name',
            aliasesById: { 'page-1': ['Working name'] },
        })).toEqual([note]);
    });
});

describe('native search tag values', () => {
    it.each([undefined, null, '', false, 0, 0n])('keeps the empty scalar %s empty', raw => {
        expect(splitSearchTags(raw)).toEqual([]);
    });

    it('preserves native array coercion, ordering, duplicates and leading-hash rules', () => {
        const raw = Object.freeze([
            '#École', '#École', ' #Keep', '', null, undefined, 0, false, 7n,
            Symbol('Tag'), ['#Nested', 'Leaf'], {},
        ]);
        expect(splitSearchTags(raw)).toEqual([
            'ecole', 'ecole', '#keep', 'null', 'undefined', '0', 'false', '7',
            'symbol(tag)', 'nested,leaf', '[object object]',
        ]);
        expect(splitSearchTags('#École,#École, #Keep,')).toEqual(['ecole', 'ecole', '#keep']);
    });

    it('calls custom string coercion with the original receiver and native hint', () => {
        const primitive = {
            [Symbol.toPrimitive](this: unknown, hint: string): string {
                expect(this).toBe(primitive);
                expect(hint).toBe('string');
                return '#École,#Leaf';
            },
        };
        const method = {
            toString(this: unknown): string {
                expect(this).toBe(method);
                return '#Méthode';
            },
        };
        expect(splitSearchTags(primitive)).toEqual(['ecole', 'leaf']);
        expect(splitSearchTags([primitive, method, primitive])).toEqual([
            'ecole,#leaf', 'methode', 'ecole,#leaf',
        ]);
    });

    it('propagates native coercion errors instead of dropping the tag or row', () => {
        const failure = new Error('tag conversion failed');
        const tag = { toString(): string { throw failure; } };
        const note = { id: 'p', title: 'Page', metadata: { tags: [tag] } };
        for (const read of [
            () => splitSearchTags(tag),
            () => splitSearchTags([tag]),
            () => searchGlobalNotes({ notes: [note], query: 'page' }),
        ]) {
            let caught: unknown;
            try { read(); } catch (error) { caught = error; }
            expect(caught).toBe(failure);
        }
        const invalid = { toString: () => ({}), valueOf: () => ({}) };
        expect(() => splitSearchTags(invalid)).toThrow(TypeError);
    });

    it('reads tag fields by stable ID and falls back to the name only for nullish values', () => {
        const fields = buildTagFieldsByTable([{
            id: 'db', properties: [{ id: 'fld_tags', name: 'Etiquetes', config: { role: 'tags' } }],
        }]);
        const read = (value: unknown) => getSearchNoteTags({
            resolved_table_id: 'db',
            metadata: { tags: ['base'], fld_tags: value, Etiquetes: ['name'] },
        }, fields);
        expect(read(['id'])).toEqual(['base', 'id']);
        expect(read(null)).toEqual(['base', 'name']);
        expect(read(undefined)).toEqual(['base', 'name']);
        for (const value of ['', false, 0, []]) expect(read(value)).toEqual(['base']);
        expect(getSearchNoteTags({ metadata: { table_id: 'db', Etiquetes: ['name'] } }, fields))
            .toEqual(['name']);
        expect(getSearchNoteTags({ metadata: { database_table_id: 'db', fld_tags: ['id'] } }, fields))
            .toEqual(['id']);
    });

    it('does not read the name fallback when a field ID supplies a value', () => {
        const fields = buildTagFieldsByTable([{
            id: 'db', properties: [{ id: 'stable', name: 'Tags', type: 'multi_select' }],
        }]);
        const metadata = {
            table_id: 'db', stable: [],
            get Tags(): never { throw new Error('name must not be read'); },
        };
        expect(getSearchNoteTags({ metadata }, fields)).toEqual([]);
    });
});

describe('open search metadata contracts', () => {
    it('preserves original rows and opaque metadata without traversing cycles or getters', () => {
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        const arrayCycle: unknown[] = [];
        arrayCycle.push(arrayCycle);
        const readOpaque = vi.fn((): never => { throw new Error('opaque getter'); });
        const metadata = Object.freeze({
            tags: ['searchable'], cycle, arrayCycle,
            blob: new Blob(['private']), callback: () => 'private', symbol: Symbol('private'),
            extension: { hiddenText: 'opaque-only' },
            get opaque(): never { return readOpaque(); },
        });
        const row = Object.freeze({
            id: 'p', title: 'Mercè', metadata, plugin: cycle,
            get opaque(): never { return readOpaque(); },
        });
        const rows = Object.freeze([row]);
        const merged = mergeGlobalSearchNotes(rows, { p: 'Stale title', other: 'Indexed' });
        expect(merged).toHaveLength(2);
        expect(merged[0]).toBe(row);
        expect(merged[0]?.metadata).toBe(metadata);
        expect(merged[0]?.plugin).toBe(cycle);
        expect(searchGlobalNotes({ notes: rows, query: 'merce' })[0]).toBe(row);
        expect(searchGlobalNotes({ notes: rows, query: 'tag:searchable' })[0]).toBe(row);
        expect(searchGlobalNotes({ notes: rows, query: 'opaque-only' })).toEqual([]);
        expect(rows[0]).toBe(row);
        expect(row.metadata.cycle.self).toBe(cycle);
        expect(row.metadata.arrayCycle[0]).toBe(arrayCycle);
        expect(readOpaque).not.toHaveBeenCalled();
    });

    it('retains absent and null metadata through merging and searching', () => {
        const absent = Object.freeze({ id: 'absent', title: 'Page absent' });
        const nullable = Object.freeze({ id: 'null', title: 'Page null', metadata: null });
        const rows = Object.freeze([absent, nullable]);
        const merged = mergeGlobalSearchNotes(rows);
        const found = searchGlobalNotes({ notes: rows, query: 'page' });
        expect(merged[0]).toBe(absent);
        expect(merged[1]).toBe(nullable);
        expect(found[0]).toBe(absent);
        expect(found[1]).toBe(nullable);
        expect(absent).not.toHaveProperty('metadata');
        expect(nullable.metadata).toBeNull();
    });

    it('ranks before limiting, keeps tie order and excludes Calendar entries without copying rows', () => {
        const tagged = { id: 'tagged', title: 'Other', metadata: { tags: ['Mercè'] } };
        const alias = { id: 'alias', title: 'Alias page', metadata: null };
        const first = { id: 'first', title: 'Mercè', metadata: {} };
        const second = { id: 'second', title: 'Mercè', metadata: {} };
        const folderCalendar = { id: 'cal-folder', title: 'Mercè', folder: 'Calendar/2026' };
        const sourceCalendar = {
            id: 'cal-source', title: 'Mercè', metadata: { source: 'gnosi', date: '2026-08-30' },
        };
        const rows = Object.freeze([tagged, alias, folderCalendar, sourceCalendar, first, second]);
        const options = { notes: rows, query: 'merce', aliasesById: { alias: ['Mercè'] } };
        const found = searchGlobalNotes(options);
        expect(found).toHaveLength(4);
        [first, second, alias, tagged].forEach((row, index) => { expect(found[index]).toBe(row); });
        const limited = searchGlobalNotes({ ...options, limit: 2 });
        expect(limited).toHaveLength(2);
        expect(limited[0]).toBe(first);
        expect(limited[1]).toBe(second);
        expect(rows[0]).toBe(tagged);
        expect(searchGlobalNotes({ ...options, limit: 0 })).toEqual([]);
        expect(searchGlobalNotes({ ...options, query: ' ' })).toEqual([]);
    });

    it('preserves combined operators, hierarchical tags, aliases and regex state', () => {
        const row = {
            id: 'p', title: 'Mercè handbook', folder: 'BD/Recerca', is_database: true,
            metadata: { tags: ['Mètodes/Qualitatius'] },
        };
        const notes = [row];
        const aliasesById = { p: ['Manual'] };
        const query = 'tag:metodes path:recerca title:manual is:database /Mercè/g manual';
        expect(searchGlobalNotes({ notes, aliasesById, query })[0]).toBe(row);
        expect(searchGlobalNotes({ notes, query: 'is:page' })).toEqual([]);
        const other = { ...row, id: 'other' };
        const result = searchGlobalNotes({ notes: [row, other], query: '/Mercè/g' });
        expect(result[0]).toBe(row);
        expect(result[1]).toBe(other);
    });
});
