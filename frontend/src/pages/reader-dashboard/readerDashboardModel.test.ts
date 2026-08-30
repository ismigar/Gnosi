import { describe, expect, it } from 'vitest';

import type {
    ReaderArticle,
    ReaderInventory,
    ReaderSource,
} from '../../shared/api/reader';
import {
    groupReaderArticles,
    groupReaderSources,
    readerArticleMeta,
    readerCountsBySource,
    readerFaviconUrl,
} from './readerDashboardModel';

function source(id: number, name: string, category: string | null): ReaderSource {
    return {
        category,
        created_at: '2026-08-30T00:00:00Z',
        id,
        name,
        type: 'rss',
        url: `https://example${String(id)}.com/feed`,
    };
}

function article(
    id: number,
    publishedAt: string | null,
    sourceName = 'Source',
): ReaderArticle {
    return {
        content: 'Body',
        created_at: '2026-08-30T00:00:00Z',
        id,
        is_read: false,
        published_at: publishedAt,
        source_id: 1,
        source_name: sourceName,
        title: `Article ${String(id)}`,
        url: `https://example.com/${String(id)}`,
    };
}

const inventory: ReaderInventory = {
    categories: [],
    category_count: 0,
    count: 5,
    feed_count: 2,
    feeds: [
        { count: 2, id: 1, name: 'Zulu' },
        { count: 3, id: 2, name: 'Alpha' },
    ],
    read_count: 0,
    record_fields: [],
    scope: {
        date_from: '',
        date_to: '',
        include_full_content: false,
        limit: 200,
        offset: 0,
        read_status: 'unread',
        unread_only: true,
    },
    source: 'reader',
    unread_count: 5,
};

describe('Reader dashboard model', () => {
    it('builds privacy-explicit favicon URLs only for valid sources', () => {
        expect(readerFaviconUrl('https://example.com/feed')).toBe(
            'https://www.google.com/s2/favicons?sz=32&domain=example.com',
        );
        expect(readerFaviconUrl('not a URL')).toBeNull();
    });

    it('does not turn missing publication dates into the Unix epoch', () => {
        expect(readerArticleMeta(article(1, null), 'en-US')).toBe('Source');
        expect(readerArticleMeta(article(2, 'invalid'), 'en-US')).toBe('Source');
    });

    it('groups sources, preserves counts, and puts uncategorized last', () => {
        const counts = readerCountsBySource(inventory);
        const groups = groupReaderSources([
            source(1, 'Zulu', null),
            source(2, 'Alpha', 'Tech'),
        ], counts, 'en-US');

        expect(groups.map((group) => group.category)).toEqual(['Tech', 'Uncategorized']);
        expect(groups.map((group) => group.unread)).toEqual([3, 2]);
    });

    it('partitions articles into stable local-time buckets', () => {
        const groups = groupReaderArticles([
            article(1, '2026-08-30T12:00:00'),
            article(2, '2026-08-29T12:00:00'),
            article(3, null),
        ], {
            today: 'Today',
            yesterday: 'Yesterday',
            week: 'Week',
            month: 'Month',
            older: 'Older',
        }, new Date(2026, 7, 30, 18));

        expect(groups.map((group) => [group.key, group.items.map((item) => item.id)]))
            .toEqual([
                ['today', [1]],
                ['yesterday', [2]],
                ['older', [3]],
            ]);
    });
});
