import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReaderResourceButton } from './ReaderResourceButton';

const mocks = vi.hoisted(() => ({
    enabled: true,
    table: vi.fn(),
    save: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../shared/plugins/usePlugins', () => ({ usePlugins: () => ({ isEnabled: (id: string) => id === 'resources' && mocks.enabled }) }));
vi.mock('../../../shared/api/literature-resources', () => ({ fetchReferenceTable: mocks.table }));
vi.mock('../../../shared/api/literature', () => ({ importLiteratureWorks: mocks.save }));
vi.mock('../../../shared/notifications/toast', () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock('../../../shared/notifications/notifyError', () => ({ logError: vi.fn() }));

const article = {
    id: 11, source_id: 7, source_name: 'Daily News', title: 'News',
    url: 'https://example.test/news', content: '', is_read: true,
    created_at: '2026-09-15', published_at: '2026-09-14',
};

describe('ReaderResourceButton', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        mocks.enabled = true;
        mocks.table.mockResolvedValue({ configured: true, table_id: 'configured-resources' });
        mocks.save.mockResolvedValue({ imported_count: 1, existing_count: 0 });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        vi.clearAllMocks();
    });
    const render = (disabled = false) => {
        act(() => { root.render(<ReaderResourceButton article={article} body="<p>News body</p>" disabled={disabled} />); });
    };
    const button = (): HTMLButtonElement => {
        const element = container.querySelector('button');
        if (!element) throw new Error('Resource button missing');
        return element;
    };
    const click = async () => {
        await act(async () => { button().click(); await Promise.resolve(); });
    };
    it('is hidden when Resources is disabled', () => {
        mocks.enabled = false;
        render();
        expect(container.querySelector('button')).toBeNull();
        expect(mocks.table).not.toHaveBeenCalled();
    });
    it('waits for the complete article body', async () => {
        render(true);
        await click();
        expect(mocks.save).not.toHaveBeenCalled();
    });
    it('imports news metadata and text through the configured Resources service', async () => {
        render();
        await click();
        expect(mocks.table).toHaveBeenCalledOnce();
        expect(mocks.save).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({
            id: 'reader:11', type: 'newspaper-article', title: 'News', abstract: 'News body',
            dates: { issued: '2026-09-14' },
            publication: { container_title: 'Daily News' },
            locations: [{ landing_page_url: 'https://example.test/news' }],
        })]);
        expect(container.textContent).toContain('reader_resources_saved');
        await click();
        expect(mocks.save).toHaveBeenCalledOnce();
    });
    it('explains missing table configuration without creating a resource', async () => {
        mocks.table.mockResolvedValue({ configured: false, table_id: null });
        render();
        await click();
        expect(mocks.save).not.toHaveBeenCalled();
        expect(mocks.error).toHaveBeenCalledWith('reader_resources_configure');
    });
    it('allows retry after an import failure', async () => {
        mocks.save.mockRejectedValueOnce(new Error('offline'));
        render();
        await click();
        expect(mocks.error).toHaveBeenCalledWith('reader_resources_error');
        expect(button().disabled).toBe(false);
        await click();
        expect(mocks.save).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('reader_resources_saved');
    });
});
