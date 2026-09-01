import { describe, expect, it, vi } from 'vitest';

import { buildColumnLayoutCatalog } from './slashMenuUtils';

interface TestColumnBlock {
    children: readonly [{ type: 'paragraph' }];
    type: 'column';
}

interface TestColumnListBlock {
    children: readonly TestColumnBlock[];
    type: 'columnList';
}

type InsertBlocks = (
    blocks: readonly TestColumnListBlock[],
    referenceBlock: unknown,
    placement: 'after',
) => void;

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
        const insertBlocks = vi.fn<InsertBlocks>();
        const editor = {
            getTextCursorPosition: () => ({ block: anchor }),
            insertBlocks,
        };
        const catalog = buildColumnLayoutCatalog({ editor });

        const fiveColumnLayout = catalog.at(3);
        expect(fiveColumnLayout).toBeDefined();
        if (!fiveColumnLayout) throw new Error('Expected the five-column layout');
        fiveColumnLayout.onItemClick();

        expect(insertBlocks).toHaveBeenCalledOnce();
        const call = insertBlocks.mock.calls.at(0);
        expect(call).toBeDefined();
        if (!call) throw new Error('Expected insertBlocks to be called');
        const [blocks, referenceBlock, placement] = call;
        expect(referenceBlock).toBe(anchor);
        expect(placement).toBe('after');
        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('columnList');
        expect(blocks[0]?.children).toHaveLength(5);
        expect(blocks[0]?.children).toEqual(
            Array.from({ length: 5 }, () => ({
                type: 'column',
                children: [{ type: 'paragraph' }],
            })),
        );
    });
});
