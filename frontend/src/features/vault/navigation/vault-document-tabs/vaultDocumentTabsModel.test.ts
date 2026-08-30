import { describe, expect, it } from 'vitest';

import {
    calculateQuickOpenPosition,
    canQuickOpenInParallel,
    filterQuickOpenItems,
    foldDocumentSearch,
    tabIndexForShortcut,
} from './vaultDocumentTabsModel';


describe('vaultDocumentTabsModel', () => {
    it('folds accents and filters titles or subtitles', () => {
        expect(foldDocumentSearch('Història')).toBe('historia');
        expect(filterQuickOpenItems([
            { id: '1', subtitle: 'Taula', title: 'Història', type: 'page' },
            { id: '2', subtitle: 'Research', title: 'Notes', type: 'table' },
        ], 'historia')).toEqual([
            { id: '1', subtitle: 'Taula', title: 'Història', type: 'page' },
        ]);
        expect(filterQuickOpenItems([
            { id: '2', subtitle: 'Research', title: 'Notes', type: 'table' },
        ], 'research')).toHaveLength(1);
    });

    it('limits the unfiltered quick-open catalog', () => {
        const items = Array.from({ length: 14 }, (_, index) => ({
            id: String(index),
            title: `Item ${String(index)}`,
            type: 'page',
        }));
        expect(filterQuickOpenItems(items, '')).toHaveLength(12);
    });

    it('only permits pages and tables in parallel with a handler', () => {
        expect(canQuickOpenInParallel({ id: '1', type: 'page' }, true)).toBe(true);
        expect(canQuickOpenInParallel({ id: '2', type: 'file' }, true)).toBe(false);
        expect(canQuickOpenInParallel({ id: '3', type: 'table' }, false)).toBe(false);
    });

    it('keeps the dropdown inside both viewport margins', () => {
        expect(calculateQuickOpenPosition({ bottom: 20, left: 950 }, 1000)).toEqual({
            left: 604,
            top: 28,
            width: 380,
        });
        expect(calculateQuickOpenPosition(null, 300)).toEqual({
            left: 16,
            top: 16,
            width: 268,
        });
    });

    it('maps shortcuts 1–8 directly and 9 to the final tab', () => {
        expect(tabIndexForShortcut('1', 4)).toBe(0);
        expect(tabIndexForShortcut('8', 4)).toBe(3);
        expect(tabIndexForShortcut('9', 4)).toBe(3);
        expect(tabIndexForShortcut('0', 4)).toBeNull();
        expect(tabIndexForShortcut('1', 0)).toBeNull();
    });
});
