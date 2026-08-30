import type { TFunction } from 'i18next';
import { MessageSquare, Star } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import {
    buildPageActionItems,
    inlinePageActionBudget,
    partitionPageActions,
    type PageActionItem,
} from './pageActionsBarModel';


const t = ((key: string, fallback?: string) => fallback ?? key) as TFunction;


describe('pageActionsBarModel', () => {
    it('applies the established width budgets', () => {
        expect(inlinePageActionBudget()).toBe(Number.POSITIVE_INFINITY);
        expect(inlinePageActionBudget(1024)).toBe(Number.POSITIVE_INFINITY);
        expect(inlinePageActionBudget(900)).toBe(6);
        expect(inlinePageActionBudget(700)).toBe(4);
        expect(inlinePageActionBudget(500)).toBe(3);
        expect(inlinePageActionBudget(400)).toBe(1);
    });

    it('builds only enabled actions in the stable order', () => {
        const onFavorite = vi.fn();
        const items = buildPageActionItems({
            canDeleteCurrentPage: true,
            canFavorite: true,
            canOpenShare: false,
            isFavorite: true,
            onToggleFavorite: onFavorite,
        }, t);

        expect(items.map((item) => item.key)).toEqual(['favorite', 'delete']);
        expect(items[0]).toMatchObject({ active: true, fillWhenActive: true });
        expect(items[1]?.danger).toBe(true);
    });

    it('keeps favorite inline on compact screens and preserves custom overflow actions', () => {
        const items: PageActionItem[] = [
            { Icon: Star, key: 'favorite', label: 'Favorite' },
            { Icon: MessageSquare, key: 'comments', label: 'Comments' },
        ];
        const custom: PageActionItem = { Icon: Star, key: 'custom', label: 'Custom' };

        const result = partitionPageActions({
            compactHeader: false,
            compactOverflowItems: [custom],
            containerWidth: 500,
            isCompact: true,
            items,
        });

        expect(result.inline.map((item) => item.key)).toEqual(['favorite']);
        expect(result.overflow.map((item) => item.key)).toEqual(['custom', 'comments']);
    });

    it('prioritizes favorite, comments, and active modes on desktop', () => {
        const items: PageActionItem[] = [
            { Icon: Star, key: 'favorite', label: 'Favorite' },
            { Icon: MessageSquare, key: 'comments', label: 'Comments' },
            { Icon: Star, active: true, key: 'code', label: 'Code' },
            { Icon: Star, key: 'history', label: 'History' },
        ];

        const result = partitionPageActions({
            compactHeader: false,
            compactOverflowItems: [],
            containerWidth: 1200,
            isCompact: false,
            items,
        });

        expect(result.inline.map((item) => item.key)).toEqual(['favorite', 'comments', 'code']);
        expect(result.overflow.map((item) => item.key)).toEqual(['history']);
    });
});
