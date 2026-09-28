import { describe, expect, it } from 'vitest';
import { viewHeightPercent } from './viewHeight';

describe('saved view height percentages', () => {
    it.each([undefined, null, '', '45', Number.NaN, Number.POSITIVE_INFINITY])('defaults invalid or legacy values to 70%% (%s)', value => {
        expect(viewHeightPercent(value)).toBe(70);
    });
    it.each([[45, 45], [0, 1], [-20, 1], [150, 100], [49.6, 50]])('bounds %s to %s', (value, expected) => {
        expect(viewHeightPercent(value)).toBe(expected);
    });
});
