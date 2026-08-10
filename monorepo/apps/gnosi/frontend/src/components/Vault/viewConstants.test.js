import { describe, expect, it } from 'vitest';
import { isMainView, isPageEmbedView, isViewHidden } from './viewConstants';

describe('viewConstants', () => {
    describe('isPageEmbedView', () => {
        it('returns true when a filter carries value "this"', () => {
            expect(isPageEmbedView({ id: 'v1', filters: [{ field: 'ref', value: 'this' }] })).toBe(true);
        });

        it('returns false when explicit embedded property is false', () => {
            expect(isPageEmbedView({ id: 'v1', embedded: false, filters: [{ field: 'ref', value: 'this' }] })).toBe(false);
        });

        it('returns false for global database views without "this" filter', () => {
            const uuidv5 = '12345678-1234-5678-89ab-cdef01234567';
            expect(isPageEmbedView({ id: uuidv5, name: 'Setmana', type: 'calendar', embedded: true })).toBe(false);
            expect(isPageEmbedView({ id: 'v2', name: 'Avui', type: 'table' })).toBe(false);
        });
    });

    describe('isMainView', () => {
        it('prefers non-page-embed views for main view selection', () => {
            const tableViews = [
                { id: 'v-embed', name: 'Project Tasks', is_main: true, filters: [{ field: 'Projecte', value: 'this' }] },
                { id: 'v-main', name: 'Main Table', is_main: false },
            ];
            expect(isMainView(tableViews[1], tableViews)).toBe(true);
            expect(isMainView(tableViews[0], tableViews)).toBe(false);
        });

        it('identifies canonical default or explicit main view correctly', () => {
            const tableViews = [
                { id: 'default', name: 'Main Table' },
                { id: 'v2', name: 'Custom View', type: 'board' },
            ];
            expect(isMainView(tableViews[0], tableViews)).toBe(true);
            expect(isMainView(tableViews[1], tableViews)).toBe(false);
        });

        it('treats locked views as protected main views', () => {
            const tableViews = [
                { id: 'v-locked', name: 'Protected', locked: true, type: 'board' },
                { id: 'v-custom', name: 'Custom', type: 'gallery' },
            ];
            expect(isMainView(tableViews[0], tableViews)).toBe(true);
            expect(isMainView(tableViews[1], tableViews)).toBe(false);
        });
    });

    describe('isViewHidden', () => {
        const tableViews = [
            { id: 'default', name: 'Main Table', is_main: true },
            { id: 'v2', name: 'Setmana', type: 'calendar' },
            { id: 'v3', name: 'Contextual Embed', filters: [{ field: 'ref', value: 'this' }] },
        ];

        it('never hides the main view', () => {
            expect(isViewHidden(tableViews[0], tableViews)).toBe(false);
            expect(isViewHidden({ ...tableViews[0], hidden: true }, tableViews)).toBe(false);
        });

        it('does not hide global database views like Setmana by default', () => {
            expect(isViewHidden(tableViews[1], tableViews)).toBe(false);
        });

        it('hides true page embed views (with "this" filter) by default', () => {
            expect(isViewHidden(tableViews[2], tableViews)).toBe(true);
        });

        it('respects explicit hidden: true on regular views', () => {
            const hiddenRegularView = { ...tableViews[1], hidden: true };
            expect(isViewHidden(hiddenRegularView, tableViews)).toBe(true);
        });
    });
});
