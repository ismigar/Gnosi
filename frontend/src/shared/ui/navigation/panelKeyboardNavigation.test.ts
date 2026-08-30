import { describe, expect, it } from 'vitest';
import {
    getPanelScrollTarget,
} from './panelKeyboardNavigation';

describe('scrollable panel keyboard navigation', () => {
    it('moves by a row-sized step with the arrow keys', () => {
        expect(getPanelScrollTarget('ArrowDown', 100, 300, 1000)).toBe(156);
        expect(getPanelScrollTarget('ArrowUp', 100, 300, 1000)).toBe(44);
    });

    it('supports page and boundary navigation without overscrolling', () => {
        expect(getPanelScrollTarget('PageDown', 600, 300, 1000)).toBe(700);
        expect(getPanelScrollTarget('Home', 500, 300, 1000)).toBe(0);
        expect(getPanelScrollTarget('End', 0, 300, 1000)).toBe(700);
    });

    it('ignores unrelated keys', () => {
        expect(getPanelScrollTarget('Enter', 100, 300, 1000)).toBeNull();
    });
});
