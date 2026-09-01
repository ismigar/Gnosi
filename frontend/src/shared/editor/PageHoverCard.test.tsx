import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { fetchVaultPage, fetchVaultPagePreview } from '../api/vaults';
import { PageHoverCard } from './PageHoverCard';
import { invalidateHoverPreviewCache } from './page-hover-card/pageHoverCardModel';


vi.mock('../api/vaults', () => ({
    fetchVaultPage: vi.fn(),
    fetchVaultPagePreview: vi.fn(),
}));


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback ?? key,
    }),
}));


vi.mock('../ui/previews/IconRenderer', () => ({
    IconRenderer: ({ icon }: { icon?: string | null }) => (
        <span data-testid="preview-icon">{icon}</span>
    ),
}));


vi.mock('./VaultMarkdown', () => ({
    VaultMarkdown: ({ md, onActivate }: { md: string; onActivate?: () => void }) => (
        <button data-testid="preview-markdown" onClick={onActivate} type="button">{md}</button>
    ),
}));


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];


beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});


afterEach(() => {
    vi.clearAllMocks();
    invalidateHoverPreviewCache();
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) continue;
        act(() => {
            mounted.root.unmount();
        });
        mounted.container.remove();
    }
});


function render(element: ReactElement): void {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });
    act(() => {
        root.render(element);
    });
}


async function flushPreview(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}


const anchorRect = new DOMRect(24, 40, 120, 20);


describe('PageHoverCard', () => {
    it('renders the full body and opens the selected page', async () => {
        vi.mocked(fetchVaultPagePreview).mockResolvedValueOnce({
            body_md: 'Complete body',
            cover: '/cover.png',
            excerpt: 'Short excerpt',
            icon: '📘',
            id: 'page-1',
            title: 'Record title',
        });
        const onOpenPage = vi.fn();

        render(<PageHoverCard anchorRect={anchorRect} onOpenPage={onOpenPage} pageId="page-1" />);
        await flushPreview();

        expect(fetchVaultPagePreview).toHaveBeenCalledWith('page-1', { full: true });
        expect(document.body.querySelector('[data-testid="page-hover-card"]')?.getAttribute('aria-label'))
            .toBe('Record title');
        expect(document.body.querySelector('[data-testid="preview-icon"]')?.textContent).toBe('📘');
        expect(document.body.querySelector('[data-testid="preview-markdown"]')?.textContent)
            .toBe('Complete body');

        act(() => {
            document.body.querySelector<HTMLButtonElement>('[data-testid="preview-markdown"]')?.click();
        });
        expect(onOpenPage).toHaveBeenCalledWith('page-1');
    });

    it('loads metadata and exposes an external link for a bodyless record', async () => {
        vi.mocked(fetchVaultPagePreview).mockResolvedValueOnce({
            body_md: null,
            excerpt: '',
            id: 'page-2',
            title: 'Metadata record',
        });
        vi.mocked(fetchVaultPage).mockResolvedValueOnce({
            content: '',
            etag: 'etag-1',
            folder: '',
            id: 'page-2',
            metadata: { owner: 'Ada', URL: 'https://example.test/source' },
            title: 'Metadata record',
        });

        render(<PageHoverCard anchorRect={anchorRect} pageId="page-2" />);
        await flushPreview();
        await flushPreview();

        expect(fetchVaultPage).toHaveBeenCalledWith('page-2');
        expect(document.body.textContent).toContain('Ada');
        expect(document.body.querySelector<HTMLAnchorElement>('a')?.href)
            .toBe('https://example.test/source');
    });

    it('renders a recoverable error when the preview request fails', async () => {
        vi.mocked(fetchVaultPagePreview).mockRejectedValueOnce(new Error('unavailable'));

        render(<PageHoverCard anchorRect={anchorRect} pageId="page-error" />);
        await flushPreview();

        expect(document.body.textContent).toContain('Could not load the page');
    });
});
