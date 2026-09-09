import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchReaderArticle, type ReaderArticle } from '../../../shared/api/reader';
import { ReaderArticleContent } from './ReaderArticleContent';

vi.mock('../../../shared/api/reader', () => ({ fetchReaderArticle: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const summary: ReaderArticle = {
    id: 1, source_id: 1, title: 'Article', url: 'https://example.test/article',
    content: '', is_read: false, created_at: '2026-09-01T00:00:00Z',
};

function deferred() {
    let resolve!: (article: ReaderArticle) => void;
    const promise = new Promise<ReaderArticle>((done) => { resolve = done; });
    return { promise, resolve };
}

describe('ReaderArticleContent loading', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        vi.mocked(fetchReaderArticle).mockReset();
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
    });

    async function render(article = summary, loadFullContent = true) {
        await act(async () => {
            root.render(<ReaderArticleContent article={article} loadFullContent={loadFullContent} locale="en" onBack={() => {}} onMarkRead={() => {}} />);
            await Promise.resolve();
        });
    }

    it('loads complete text only for the selected summary', async () => {
        const pending = deferred();
        vi.mocked(fetchReaderArticle).mockReturnValue(pending.promise);
        await render();
        expect(container.querySelector('[role="status"]')).not.toBeNull();
        expect(fetchReaderArticle).toHaveBeenCalledWith(1, expect.any(AbortSignal));
        await act(async () => { pending.resolve({ ...summary, full_content: 'Complete text' }); await pending.promise; });
        expect(container.textContent).toContain('Complete text');
        expect(container.querySelector('[role="status"]')).toBeNull();
        await render({ ...summary, is_read: true });
        expect(fetchReaderArticle).toHaveBeenCalledTimes(1);
    });

    it('aborts an old selection and ignores its late response', async () => {
        const first = deferred();
        const second = deferred();
        vi.mocked(fetchReaderArticle).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        await render();
        const firstSignal = vi.mocked(fetchReaderArticle).mock.calls[0]?.[1];
        await render({ ...summary, id: 2 });
        expect(firstSignal?.aborted).toBe(true);
        await act(async () => { first.resolve({ ...summary, full_content: 'Old body' }); await first.promise; });
        expect(container.textContent).not.toContain('Old body');
        await act(async () => { second.resolve({ ...summary, id: 2, full_content: 'New body' }); await second.promise; });
        expect(container.textContent).toContain('New body');
    });

    it('offers retry after failure and then shows the complete body', async () => {
        vi.mocked(fetchReaderArticle).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...summary, content: 'Recovered body' });
        await render();
        const retry = container.querySelector('[role="alert"] button');
        expect(retry).not.toBeNull();
        await act(async () => { (retry as HTMLButtonElement).click(); await Promise.resolve(); });
        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(container.textContent).toContain('Recovered body');
    });

    it('renders an already loaded deep link without requesting its body again', async () => {
        await render({ ...summary, content: 'Already loaded' }, false);
        expect(container.textContent).toContain('Already loaded');
        expect(fetchReaderArticle).not.toHaveBeenCalled();
    });
});
