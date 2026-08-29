import { describe, expect, it, vi } from 'vitest';

import {
    extractEditorText,
    fitSpellMenu,
    getSpellSuggestions,
} from './spellCheckModel';


describe('spellCheckModel', () => {
    it('extracts text from nested BlockNote content', () => {
        expect(extractEditorText([
            { content: [{ text: 'Hola' }, { text: ' món' }] },
            { content: [{ content: [{ text: 'Segona línia' }] }] },
        ])).toBe('Hola món Segona línia');
    });

    it('limits suggestions and tolerates dictionary failures', () => {
        const suggest = vi.fn(() => ['1', '2', '3', '4', '5', '6', '7', '8']);
        expect(getSpellSuggestions({ add: vi.fn(), correct: vi.fn(), suggest }, 'hola'))
            .toEqual(['1', '2', '3', '4', '5', '6', '7']);
        expect(getSpellSuggestions({
            add: vi.fn(),
            correct: vi.fn(),
            suggest: () => { throw new Error('dictionary unavailable'); },
        }, 'hola')).toEqual([]);
    });

    it('keeps the menu inside small and large viewports', () => {
        expect(fitSpellMenu({ x: 990, y: 790 }, { width: 1000, height: 800 }))
            .toEqual({ left: 770, top: 540 });
        expect(fitSpellMenu({ x: -20, y: -10 }, { width: 200, height: 180 }))
            .toEqual({ left: 8, top: 8 });
    });
});
