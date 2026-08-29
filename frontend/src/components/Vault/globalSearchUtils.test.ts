import { describe, expect, it } from 'vitest';

import {
    isGlobalSearchShortcut,
    mergeGlobalSearchNotes,
    searchGlobalNotes,
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
