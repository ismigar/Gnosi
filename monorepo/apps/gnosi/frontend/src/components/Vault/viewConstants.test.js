import { describe, expect, it } from 'vitest';
import { isMainView, isPageEmbedView, isViewHidden } from './viewConstants';

describe('viewConstants', () => {
    describe('isPageEmbedView', () => {
        it('returns true when explicit embedded property is true', () => {
            expect(isPageEmbedView({ id: 'v1', embedded: true })).toBe(true);
        });

        it('returns false when explicit embedded property is false', () => {
            expect(isPageEmbedView({ id: 'v1', embedded: false })).toBe(false);
        });

        it('detects page embed filter with value "this" and no operator', () => {
            expect(isPageEmbedView({ id: 'v1', filters: [{ field: 'ref', value: 'this' }] })).toBe(true);
        });

        it('detects UUID v5 as page embed signature', () => {
            // UUID v5 has 5 in 13th char: e.g. 12345678-1234-5678-89ab-cdef01234567
            const uuidv5 = '12345678-1234-5678-89ab-cdef01234567';
            expect(isPageEmbedView({ id: uuidv5 })).toBe(true);
        });

        it('returns false for standard views without embed markers', () => {
            expect(isPageEmbedView({ id: '12345678-1234-4678-89ab-cdef01234567', name: 'Grid' })).toBe(false);
        });
    });

    describe('isViewHidden', () => {
        const tableViews = [
            { id: 'default', name: 'Main Table', is_main: true },
            { id: 'v2', name: 'Custom View' },
            { id: 'v3', name: 'Page Embed', embedded: true },
        ];

        it('never hides the main view', () => {
            expect(isViewHidden(tableViews[0], tableViews)).toBe(false);
            expect(isViewHidden({ ...tableViews[0], hidden: true }, tableViews)).toBe(false);
        });

        it('hides page embed views by default', () => {
            expect(isViewHidden(tableViews[2], tableViews)).toBe(true);
        });

        it('respects explicit hidden: false on page embed views', () => {
            const unhiddenPageEmbed = { ...tableViews[2], hidden: false };
            expect(isViewHidden(unhiddenPageEmbed, tableViews)).toBe(false);
        });

        it('respects explicit hidden: true on regular views', () => {
            const hiddenRegularView = { ...tableViews[1], hidden: true };
            expect(isViewHidden(hiddenRegularView, tableViews)).toBe(true);
        });

        it('does not hide regular views by default', () => {
            expect(isViewHidden(tableViews[1], tableViews)).toBe(false);
        });
    });
});
