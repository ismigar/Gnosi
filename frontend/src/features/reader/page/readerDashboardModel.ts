import type {
    ReaderArticle,
    ReaderInventory,
    ReaderSource,
} from '../../../shared/api/reader';

export interface ReaderSourceGroup {
    readonly category: string;
    readonly items: readonly ReaderSource[];
    readonly unread: number;
}

export interface ReaderArticleGroup {
    readonly items: readonly ReaderArticle[];
    readonly key: ReaderArticleBucket;
    readonly label: string;
}

export type ReaderArticleBucket = 'month' | 'older' | 'today' | 'week' | 'yesterday';
export type ReaderArticleLabels = Readonly<Record<ReaderArticleBucket, string>>;

export function readerFaviconUrl(sourceUrl: string): string | null {
    try {
        const hostname = new URL(sourceUrl).hostname;
        return `https://www.google.com/s2/favicons?sz=32&domain=${hostname}`;
    } catch {
        return null;
    }
}

export function readerArticleMeta(article: ReaderArticle, locale: string): string {
    const published = article.published_at ? new Date(article.published_at) : null;
    const date = published && !Number.isNaN(published.getTime())
        ? published.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
        : '';
    return [article.source_name, date].filter(Boolean).join(' · ');
}

export function readerCountsBySource(
    inventory: ReaderInventory,
): ReadonlyMap<number, number> {
    const counts = new Map<number, number>();
    for (const feed of inventory.feeds) {
        counts.set(feed.id, feed.count);
    }
    return counts;
}

function isUncategorized(category: string): boolean {
    return category === 'Uncategorized' || category === 'Sense categoria';
}

export function groupReaderSources(
    sources: readonly ReaderSource[],
    counts: ReadonlyMap<number, number>,
    locale: string,
): ReaderSourceGroup[] {
    const grouped = new Map<string, ReaderSource[]>();
    for (const source of sources) {
        const category = source.category?.trim() || 'Uncategorized';
        const current = grouped.get(category) ?? [];
        current.push(source);
        grouped.set(category, current);
    }
    const entries = Array.from(grouped.entries()).map(([category, items]) => ({
        category,
        items: [...items].sort((first, second) => first.name.localeCompare(second.name, locale)),
        unread: items.reduce((total, source) => total + (counts.get(source.id) ?? 0), 0),
    }));
    return entries.sort((first, second) => {
        if (isUncategorized(first.category)) return 1;
        if (isUncategorized(second.category)) return -1;
        return first.category.localeCompare(second.category, locale);
    });
}

export function groupReaderArticles(
    articles: readonly ReaderArticle[],
    labels: ReaderArticleLabels,
    now = new Date(),
): ReaderArticleGroup[] {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const thresholds: Readonly<Record<Exclude<ReaderArticleBucket, 'older'>, number>> = {
        today: startOfDay,
        yesterday: startOfDay - 86_400_000,
        week: startOfDay - 6 * 86_400_000,
        month: startOfDay - 29 * 86_400_000,
    };
    const buckets: Record<ReaderArticleBucket, ReaderArticle[]> = {
        today: [],
        yesterday: [],
        week: [],
        month: [],
        older: [],
    };
    for (const article of articles) {
        const publishedAt = article.published_at
            ? new Date(article.published_at).getTime()
            : Number.NEGATIVE_INFINITY;
        const bucket = publishedAt >= thresholds.today ? 'today'
            : publishedAt >= thresholds.yesterday ? 'yesterday'
                : publishedAt >= thresholds.week ? 'week'
                    : publishedAt >= thresholds.month ? 'month'
                        : 'older';
        buckets[bucket].push(article);
    }
    const order: readonly ReaderArticleBucket[] = ['today', 'yesterday', 'week', 'month', 'older'];
    return order
        .filter((key) => buckets[key].length > 0)
        .map((key) => ({ key, label: labels[key], items: buckets[key] }));
}
