import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReaderArticle, ReaderSource } from '../../shared/api/reader';
import ReaderDashboard from './ReaderDashboard';

const source: ReaderSource = {
    category: 'Tech',
    created_at: '2026-08-30T00:00:00Z',
    id: 7,
    name: 'Source Seven',
    type: 'rss',
    url: 'https://example.com/feed',
};
const article: ReaderArticle = {
    content: 'Body',
    created_at: '2026-08-30T00:00:00Z',
    id: 11,
    is_read: false,
    published_at: '2026-08-30T12:00:00Z',
    source_id: 7,
    source_name: 'Source Seven',
    title: 'Article Eleven',
    url: 'https://example.com/article',
};

const mocks = vi.hoisted(() => ({
    articleRefetch: vi.fn(() => Promise.resolve(undefined)),
    emitEvent: vi.fn(),
    fetchArticle: vi.fn(),
    inventoryRefetch: vi.fn(() => Promise.resolve(undefined)),
    markRead: vi.fn(() => Promise.resolve(undefined)),
    runTask: vi.fn(() => Promise.resolve({ success: true })),
    sourceRefetch: vi.fn(() => Promise.resolve(undefined)),
    useArticles: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        i18n: { language: 'en', resolvedLanguage: 'en' },
        t: (key: string, fallback?: string | { readonly defaultValue?: string }) => (
            typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key
        ),
    }),
}));
vi.mock('../../shared/ui/layout/AppHeader', () => ({
    AppHeader: ({ children, title }: { readonly children?: ReactNode; readonly title: ReactNode }) => <header>{title}{children}</header>,
}));
vi.mock('../../shared/plugins/usePlugins', () => ({ usePlugins: () => ({ isEnabled: () => false }) }));
vi.mock('../../shared/notifications/toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('../../shared/notifications/notifyError', () => ({ logError: vi.fn() }));
vi.mock('../../shared/api/scheduler', () => ({ runScheduledTask: mocks.runTask }));
vi.mock('../../shared/platform/app-events', () => ({ emitAppEvent: mocks.emitEvent }));
vi.mock('../../shared/api/reader', async () => {
    const actual = await vi.importActual<typeof import('../../shared/api/reader')>(
        '../../shared/api/reader',
    );
    return {
        ...actual,
        fetchReaderArticle: mocks.fetchArticle,
        fetchReaderPodcastStatus: vi.fn(),
        generateReaderPodcast: vi.fn(),
        readerPodcastUrl: () => '/api/reader/podcast',
    };
});
vi.mock('../../shared/api/useReaderData', () => ({
    useMarkReaderArticleRead: () => ({ mutateAsync: mocks.markRead }),
    useReaderArticles: mocks.useArticles,
    useReaderInventory: () => ({
        data: {
            count: 1,
            feeds: [{ count: 1, id: 7, name: 'Source Seven' }],
        },
        refetch: mocks.inventoryRefetch,
    }),
    useReaderPodcastInfo: () => ({
        data: null,
        refetch: vi.fn(() => Promise.resolve(undefined)),
    }),
    useReaderSources: () => ({ data: [source], refetch: mocks.sourceRefetch }),
}));
vi.mock('./page/ReaderChannels', () => ({
    ReaderChannels: ({
        onSelectSource,
        selectedSourceId,
    }: {
        readonly onSelectSource: (sourceId: number | null) => void;
        readonly selectedSourceId: number | null;
    }) => <button
        data-selected-source={selectedSourceId ?? 'all'}
        data-testid="select-source"
        onClick={() => { onSelectSource(7); }}
        type="button"
    >channels</button>,
}));
vi.mock('./page/ReaderArticleContent', () => ({
    ReaderArticleContent: ({ article: selected }: { readonly article: ReaderArticle }) => <div data-testid="article-content">{selected.title}</div>,
}));

const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe('ReaderDashboard', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
        window.history.replaceState({}, '', '/reader');
        mocks.fetchArticle.mockResolvedValue(article);
        mocks.useArticles.mockImplementation(() => ({
            data: [article],
            isPending: false,
            refetch: mocks.articleRefetch,
        }));
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    const button = (selector: string): HTMLButtonElement => {
        const element = container.querySelector<HTMLButtonElement>(selector);
        if (!element) throw new Error(`Button missing: ${selector}`);
        return element;
    };

    const renderDashboard = (): void => {
        act(() => { root.render(<ReaderDashboard />); });
    };

    it('publishes Reader context and keeps read articles in the all-sources query', () => {
        renderDashboard();

        expect(mocks.useArticles).toHaveBeenCalledWith({
            sourceIds: undefined,
            unreadOnly: false,
            includeContent: false,
        });
        expect(mocks.emitEvent).toHaveBeenCalledWith(
            'gnosi:module-context',
            expect.arrayContaining([expect.objectContaining({ ref: 'reader' })]),
        );
        expect(container.querySelector('[data-article-id="11"]')).not.toBeNull();
    });

    it('switches the query to the selected source', () => {
        renderDashboard();
        const sourceButton = container.querySelector<HTMLButtonElement>('[data-testid="select-source"]');
        if (!sourceButton) throw new Error('Source button missing');
        expect(sourceButton.getAttribute('data-selected-source')).toBe('all');
        act(() => { sourceButton.click(); });

        expect(mocks.useArticles).toHaveBeenLastCalledWith({
            sourceIds: [7],
            unreadOnly: false,
            includeContent: false,
        });
        expect(container.querySelector('[data-testid="select-source"]')?.getAttribute('data-selected-source'))
            .toBe('7');
    });

    it('opens only the article where keyboard navigation pauses for 500ms', async () => {
        vi.useFakeTimers();
        mocks.useArticles.mockReturnValue({
            data: [article, { ...article, id: 12, title: 'Article Twelve' }, { ...article, id: 13, title: 'Article Thirteen', is_read: true }],
            isPending: false,
            refetch: mocks.articleRefetch,
        });
        renderDashboard();
        const first = button('[data-article-id="11"]');
        act(() => { first.focus(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        act(() => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
        expect(document.activeElement?.getAttribute('data-article-id')).toBe('12');
        await act(async () => { await vi.advanceTimersByTimeAsync(499); });
        expect(mocks.markRead).not.toHaveBeenCalled();
        expect(container.querySelector('[data-testid="article-content"]')).toBeNull();
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith({ articleId: 12, sourceId: 7 });
        expect(container.querySelector('[data-testid="article-content"]')?.textContent).toBe('Article Twelve');
        expect(container.querySelectorAll('[data-article-id]')).toHaveLength(3);
        act(() => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });
        expect(container.querySelector('[data-testid="article-content"]')?.textContent).toBe('Article Thirteen');
        expect(mocks.markRead).toHaveBeenCalledTimes(1);
        act(() => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });
        expect(document.activeElement?.getAttribute('data-article-id')).toBe('12');
    });

    it('cancels a pending keyboard opening when switching sources', async () => {
        vi.useFakeTimers();
        renderDashboard();
        act(() => { button('[data-article-id="11"]').focus(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        act(() => { button('[data-testid="select-source"]').click(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });
        expect(mocks.markRead).not.toHaveBeenCalled();
        expect(container.querySelector('[data-testid="article-content"]')).toBeNull();
    });

    it('opens clicked articles immediately and keeps them visible after marking read', async () => {
        renderDashboard();
        await act(async () => { button('[data-article-id="11"]').click(); await Promise.resolve(); });
        expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith({ articleId: 11, sourceId: 7 });
        expect(container.querySelector('[data-testid="article-content"]')?.textContent).toBe(article.title);
        expect(container.querySelector('[data-article-id="11"]')).not.toBeNull();
    });

    it('runs both sync tasks and refetches every Reader query', async () => {
        renderDashboard();
        const syncButton = container.querySelector<HTMLButtonElement>('button[title="reader_sync"]');
        if (!syncButton) throw new Error('Sync button missing');
        await act(async () => {
            syncButton.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.runTask).toHaveBeenCalledWith('fetch_feeds');
        expect(mocks.runTask).toHaveBeenCalledWith('fetch_newsletters');
        expect(mocks.articleRefetch).toHaveBeenCalledOnce();
        expect(mocks.inventoryRefetch).toHaveBeenCalledOnce();
        expect(mocks.sourceRefetch).toHaveBeenCalledOnce();
    });
});
