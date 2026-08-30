import { describe, expect, it } from 'vitest';

import {
    parseNotionConfig,
    selectedLoosePageTypes,
    sortNotionItems,
} from './notionImportModel';


describe('notionImportModel', () => {
    it('normalizes untrusted persisted configuration', () => {
        expect(parseNotionConfig({
            cloneVaultId: 42,
            loosePageTypes: { a: 'wiki', b: 'invalid' },
            selected: ['one', 2],
        })).toMatchObject({
            cloneVaultId: '__new__',
            loosePageTypes: { a: 'wiki' },
            selected: ['one'],
        });
    });

    it('sorts Notion items without mutating the input', () => {
        const input = [{ title: 'Zulu' }, { title: 'alpha' }];
        expect(sortNotionItems(input).map(({ title }) => title)).toEqual(['alpha', 'Zulu']);
        expect(input[0]?.title).toBe('Zulu');
    });

    it('materializes only selected loose page kinds', () => {
        expect(selectedLoosePageTypes(
            true,
            new Set(['a', 'b']),
            { a: 'dashboard' },
        )).toEqual({ a: 'dashboard', b: 'wiki' });
        expect(selectedLoosePageTypes(false, new Set(['a']), {})).toBeNull();
    });
});
