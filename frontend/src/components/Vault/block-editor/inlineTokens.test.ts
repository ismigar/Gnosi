import { describe, expect, it } from 'vitest';
import { expandBracketRange, legacyCursorIndex, replaceTokenInInlineArray, type PartialInlineArray } from './inlineTokens';
import { detectEmbeddableUrl } from './insertResult';

describe('atomic inline token replacement', () => {
    const replacement = { type: 'wikilink' as const, props: { title: 'Mercè', target: 'page' } };
    it('consumes at most two brackets on either side', () => {
        expect(expandBracketRange('A [[[Mercè]]] B', 5, 10)).toEqual({ start: 3, end: 12 });
        expect(expandBracketRange('Mercè', 0, 5)).toEqual({ start: 0, end: 5 });
    });
    it('replaces across styled runs while preserving both outer styles and nontext nodes', () => {
        const cite = { type: 'cite' as const, props: { citationKey: 'key' } };
        const input: PartialInlineArray = [
            { type: 'text', text: 'A [[Me', styles: { bold: true } },
            { type: 'text', text: 'rcè]] B', styles: { italic: true } }, cite,
        ];
        const result = replaceTokenInInlineArray(input, 2, 11, replacement);
        expect(result).toEqual([{ type: 'text', text: 'A ', styles: { bold: true } }, replacement, { type: 'text', text: ' B', styles: { italic: true } }, cite]);
        expect(input[0]).toEqual({ type: 'text', text: 'A [[Me', styles: { bold: true } });
    });
    it('retains the nontext width convention and returns null for no overlapping token', () => {
        expect(replaceTokenInInlineArray([{ type: 'cite', props: { citationKey: 'key' } }], 0, 1, replacement)).toEqual([replacement]);
        expect(replaceTokenInInlineArray([{ type: 'text', text: 'Hello', styles: {} }], 9, 12, replacement)).toBeNull();
        expect(legacyCursorIndex({ block: {} })).toBeUndefined();
        expect(legacyCursorIndex({ index: 3 })).toBe(3);
    });
});

describe('standalone embed URL detection', () => {
    it.each([
        ['https://youtu.be/123', 'youtube'], ['https://player.vimeo.com/video/1', 'vimeo'],
        ['https://example.invalid/a.PDF?x=1', 'pdf'], ['https://example.invalid', null],
        ['file:///tmp/a.pdf', null], ['Text https://youtu.be/123', null], ['javascript:alert(1)', null],
    ])('classifies %s without treating arbitrary text as an embed', (text, expected) => { expect(detectEmbeddableUrl(text)).toBe(expected); });
});
