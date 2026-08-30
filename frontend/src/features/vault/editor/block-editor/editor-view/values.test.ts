import { describe, expect, it } from 'vitest';
import { firstBlockChild, pastedText } from './values';

describe('editor view optional runtime boundaries', () => {
    it('retains the optional callout child guard', () => {
        expect(firstBlockChild(undefined)).toBeUndefined();
        expect(firstBlockChild(null)).toBeUndefined();
        expect(firstBlockChild({})).toBeUndefined();
        expect(firstBlockChild({ children: [] })).toBeUndefined();
    });

    it('ignores unavailable clipboard data and retains the getData receiver', () => {
        expect(pastedText(null)).toBe('');
        expect(pastedText(undefined)).toBe('');
        expect(pastedText({})).toBe('');
        const clipboard = { value: 'https://example.test', getData(format: string) { return format === 'text/plain' ? this.value : ''; } };
        expect(pastedText(clipboard)).toBe('https://example.test');
    });
});
