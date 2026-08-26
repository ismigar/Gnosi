import { describe, expect, it } from 'vitest';

import { buildVaultSidebarTrees } from './vaultSidebarTree';

describe('buildVaultSidebarTrees', () => {
    it('places Wiki children below their database row instead of at the Wiki root', () => {
        const area = {
            id: 'area-self-care',
            title: '(Auto)cura i cultiu interior',
            folder: 'BD/Àrees',
            metadata: { table_id: 'areas' },
        };
        const food = {
            id: 'food',
            title: 'Alimentació',
            folder: 'Wiki',
            parent_id: area.id,
            metadata: {},
        };
        const futureCare = {
            id: 'future-care',
            title: 'Pla de futur i cures',
            folder: 'Wiki',
            parent_id: area.id,
            metadata: {},
        };
        const foodChild = {
            id: 'food-child',
            title: 'Menús',
            folder: 'Wiki',
            parent_id: food.id,
            metadata: {},
        };

        const tree = buildVaultSidebarTrees([area, food, futureCare, foodChild]);

        expect(tree.rootPages).toEqual([]);
        expect(tree.dataChildrenMap.areas.roots).toEqual([area]);
        expect(tree.dataChildrenMap.areas.children[area.id]).toEqual([food, futureCare]);
        expect(tree.dataChildrenMap.areas.children[food.id]).toEqual([foodChild]);
    });

    it('keeps a Wiki page visible at the Wiki root when its parent is missing', () => {
        const orphan = {
            id: 'orphan',
            title: 'Orphaned page',
            folder: 'Wiki',
            parent_id: 'deleted-row',
            metadata: {},
        };

        const tree = buildVaultSidebarTrees([orphan]);

        expect(tree.rootPages).toEqual([orphan]);
        expect(tree.dataChildrenMap).toEqual({});
    });
});
