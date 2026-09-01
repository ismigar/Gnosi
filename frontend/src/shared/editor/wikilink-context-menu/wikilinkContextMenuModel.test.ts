import { describe, expect, it } from 'vitest';

import {
    adjustedContextMenuPosition,
    nextEnabledMenuIndex,
} from './wikilinkContextMenuModel';


describe('wikilinkContextMenuModel', () => {
    it('starts from the first or last enabled item based on direction', () => {
        expect(nextEnabledMenuIndex([0, 2], -1, 1)).toBe(0);
        expect(nextEnabledMenuIndex([0, 2], -1, -1)).toBe(2);
    });

    it('wraps keyboard navigation across enabled items only', () => {
        expect(nextEnabledMenuIndex([0, 2], 0, -1)).toBe(2);
        expect(nextEnabledMenuIndex([0, 2], 2, 1)).toBe(0);
        expect(nextEnabledMenuIndex([], -1, 1)).toBe(-1);
    });

    it('keeps visible positions unchanged', () => {
        expect(adjustedContextMenuPosition(
            { x: 20, y: 30 },
            { height: 100, width: 120 },
            { height: 500, width: 600 },
        )).toEqual({ x: 20, y: 30 });
    });

    it('moves overflowing menus inside the viewport padding', () => {
        expect(adjustedContextMenuPosition(
            { x: 580, y: 480 },
            { height: 100, width: 120 },
            { height: 500, width: 600 },
        )).toEqual({ x: 472, y: 392 });
    });
});
