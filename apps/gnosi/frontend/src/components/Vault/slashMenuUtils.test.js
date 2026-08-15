import { describe, expect, it, vi } from 'vitest';

import { buildColumnLayoutCatalog } from './slashMenuUtils';

describe('buildColumnLayoutCatalog', () => {
    it('offers layouts from two through five columns', () => {
        const catalog = buildColumnLayoutCatalog();

        expect(catalog.map(item => item.title)).toEqual([
            '2 columns',
            '3 columns',
            '4 columns',
            '5 columns',
        ]);
    });

    it('inserts five editable columns in one column list', () => {
        const anchor = { id: 'anchor' };
        const insertBlocks = vi.fn();
        const editor = {
            getTextCursorPosition: () => ({ block: anchor }),
            insertBlocks,
        };
        const catalog = buildColumnLayoutCatalog({ editor });

        catalog[3].onItemClick();

        expect(insertBlocks).toHaveBeenCalledOnce();
        const [blocks, referenceBlock, placement] = insertBlocks.mock.calls[0];
        expect(referenceBlock).toBe(anchor);
        expect(placement).toBe('after');
        expect(blocks).toHaveLength(1);
        expect(blocks[0].type).toBe('columnList');
        expect(blocks[0].children).toHaveLength(5);
        expect(blocks[0].children).toEqual(
            Array.from({ length: 5 }, () => ({
                type: 'column',
                children: [{ type: 'paragraph' }],
            })),
        );
    });
});
