import { describe, expect, it, vi } from 'vitest';
import type { PartialBlock } from '@blocknote/core';

import { blockHasContent, parseMailHtml } from './mailBlockNoteAdapter';


describe('mailBlockNoteAdapter', () => {
    it('recognizes empty and populated BlockNote content shapes', () => {
        expect(blockHasContent({ content: [] })).toBe(false);
        expect(blockHasContent({ content: [{ text: 'Hello' }] })).toBe(true);
        expect(blockHasContent({ content: { rows: [] } })).toBe(true);
        expect(blockHasContent({})).toBe(false);
    });

    it('returns parsed HTML blocks through the typed third-party boundary', () => {
        const blocks: PartialBlock[] = [
            { type: 'paragraph', content: [{ type: 'text', text: 'Hello', styles: {} }] },
        ];
        const tryParseHTMLToBlocks = vi.fn(() => blocks);
        const editor = { tryParseHTMLToBlocks };

        expect(parseMailHtml(editor, '<p>Hello</p>')).toHaveLength(1);
        expect(tryParseHTMLToBlocks).toHaveBeenCalledWith('<p>Hello</p>');
    });
});
