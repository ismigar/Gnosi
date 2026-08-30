import { afterEach, describe, expect, it } from 'vitest';
import { defineStorageKey, removeStorage, stringStorageCodec, writeStorage, readStorage } from '../../../shared/platform/browser-storage';
import { allowsSubitems, blocksMove, decodePageMove, groupTables, groupViews, sortFavorites } from './model';
import { readFavoritesSort, readSections, readWikiLock, saveFavoritesSort, saveSections, saveWikiLock } from './preferences';
import type { SidebarPage, SidebarView } from './types';

const keys = ['gnosi.sidebar.sections.desktop', 'gnosi.sidebar.sections.mobile', 'gnosi.sidebar.wikiDragLocked', 'gnosi.sidebar.favoritesSort'];
afterEach(() => { for (const key of keys) removeStorage(defineStorageKey(key, stringStorageCodec)); });

describe('sidebar preferences and ordering', () => {
    it('keeps independent mobile/desktop sections and exact lock keys', () => {
        expect(readSections(false)).toEqual({ favorites: false, dashboards: false, data: false, wiki: false });
        const sections = { favorites: true, dashboards: false, data: true, wiki: true };
        saveSections(false, sections);
        expect(readSections(false)).toEqual(sections);
        expect(readSections(true).wiki).toBe(false);
        expect(readStorage(defineStorageKey(keys[0] || '', stringStorageCodec))).toBe(JSON.stringify(sections));
        expect(readWikiLock()).toBe(true);
        saveWikiLock(false);
        expect(readWikiLock()).toBe(false);
        expect(readStorage(defineStorageKey('gnosi.sidebar.wikiDragLocked', stringStorageCodec))).toBe('false');
    });
    it('falls back on corrupt JSON and retains the favorites format', () => {
        writeStorage(defineStorageKey('gnosi.sidebar.sections.desktop', stringStorageCodec), '{bad');
        writeStorage(defineStorageKey('gnosi.sidebar.favoritesSort', stringStorageCodec), '{bad');
        expect(readSections(false).wiki).toBe(false);
        expect(readFavoritesSort()).toEqual({ mode: 'manual', manualOrder: [] });
        saveFavoritesSort({ mode: 'alpha-desc', manualOrder: ['b', 'a'] });
        expect(readFavoritesSort()).toEqual({ mode: 'alpha-desc', manualOrder: ['b', 'a'] });
    });
    const pages: SidebarPage[] = [
        { id: 'z', title: 'Zebra', last_modified: '2026-08-02' },
        { id: 'a', title: 'Àrea', last_modified: '2026-08-01' },
        { id: 'n', title: '10 inici' },
        { id: 'u', title: '_primer' },
    ];
    it('sorts priority prefixes before letters ascending and after letters descending', () => {
        expect(sortFavorites(pages, { mode: 'alpha-asc', manualOrder: [] }).map(p => p.id)).toEqual(['n', 'u', 'a', 'z']);
        expect(sortFavorites(pages, { mode: 'alpha-desc', manualOrder: [] }).map(p => p.id)).toEqual(['z', 'a', 'u', 'n']);
        expect(pages[0]?.id).toBe('z');
    });
    it('keeps manual ids, appends newcomers and ignores removed ids', () => {
        expect(sortFavorites(pages, { mode: 'manual', manualOrder: ['a', 'missing', 'z'] }).map(p => p.id)).toEqual(['a', 'z', 'n', 'u']);
        expect(sortFavorites(pages, { mode: 'recent', manualOrder: [] }).map(p => p.id)).toEqual(['z', 'a', 'n', 'u']);
        expect(sortFavorites(pages, { mode: 'oldest', manualOrder: [] }).map(p => p.id)).toEqual(['n', 'u', 'a', 'z']);
    });
});

describe('sidebar registry and drag contracts', () => {
    it('indexes joined views once per participating table and preserves original objects', () => {
        const view: SidebarView = { id: 'v', name: 'Joined', table_id: 'a', joins: [{ tableId: 'b' }, { tableId: 'a' }, null], enableSubitems: true };
        const grouped = groupViews([view]);
        expect(grouped).toEqual({ a: [view], b: [view] });
        expect(grouped.b?.[0]).toBe(view);
        expect(allowsSubitems(grouped)).toEqual({ a: true, b: true });
        const table = { id: 'a', name: 'Items', database_id: 'db' };
        expect(groupTables([table])).toEqual({ db: [table] });
    });
    it('uses the main table view to determine child creation', () => {
        expect(allowsSubitems({ a: [{ id: 'g', name: 'Gallery', type: 'gallery', enableSubitems: true }, { id: 't', name: 'Main', type: 'table', enableSubitems: false }] })).toEqual({ a: false });
    });
    it('retains the move traversal and tolerates cyclic input without looping', () => {
        expect(blocksMove('a', 'b', { b: [{ id: 'a', title: 'A' }] })).toBe(true);
        expect(blocksMove('a', 'b', { b: [{ id: 'b', title: 'B' }] })).toBe(false);
        expect(blocksMove('a', 'a', {})).toBe(true);
        expect(decodePageMove('{"id":"a","currentParentId":null}')).toBe('a');
        expect(decodePageMove('{"id":5}')).toBeUndefined();
        expect(() => decodePageMove('broken')).toThrow();
    });
});
