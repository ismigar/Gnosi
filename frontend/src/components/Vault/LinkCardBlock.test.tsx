import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLinkPreview, type LinkPreview } from '../../shared/api/links';
import LinkCardBlock from './LinkCardBlock';

const translations = vi.hoisted(() => ({
    t: (_key: string, fallback: string) => fallback,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => translations }));
vi.mock('../../shared/api/links', () => ({ fetchLinkPreview: vi.fn() }));

function deferredPreview() {
    let resolve!: (preview: LinkPreview) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<LinkPreview>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function preview(url: string, title = 'Fixture title'): LinkPreview {
    return { url, title, description: 'Fixture description', site_name: 'Fixture site',
        image: 'https://example.invalid/image.png', favicon: 'https://example.invalid/icon.png' };
}

let sequence = 0;
function uniqueUrl() { return `https://example.invalid/preview-${String(++sequence)}`; }

describe('LinkCardBlock input reconciliation', () => {
    let container: HTMLDivElement;
    let root: Root;
    const fetchPreview = vi.mocked(fetchLinkPreview);
    const render = (url: string) => {
        act(() => { root.render(<LinkCardBlock block={{ props: { url } }} />); });
    };

    beforeEach(() => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        translations.t = (_key, fallback) => fallback;
        fetchPreview.mockReset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        vi.unstubAllGlobals();
    });

    it('does not fetch or show a spinner for an absent or whitespace-only URL', () => {
        act(() => { root.render(<LinkCardBlock />); });
        render('   ');
        expect(fetchPreview).not.toHaveBeenCalled();
        expect(container.querySelector('.animate-spin')).toBeNull();
        expect(container.querySelector('a')?.getAttribute('href')).toBe('');
    });

    it('normalizes the URL, renders the complete preview and preserves anchor identity', async () => {
        const url = uniqueUrl();
        const request = deferredPreview();
        fetchPreview.mockReturnValue(request.promise);
        render(`  ${url}  `);
        const anchor = container.querySelector('a');
        expect(anchor?.getAttribute('href')).toBe(url);
        expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
        expect(anchor?.getAttribute('target')).toBe('_blank');
        expect(container.textContent).toContain('Loading preview…');
        await act(async () => { request.resolve(preview(url)); await request.promise; });
        expect(container.querySelector('a')).toBe(anchor);
        expect(container.textContent).toContain('Fixture title');
        expect(container.textContent).toContain('Fixture description');
        expect(container.textContent).toContain('Fixture site');
        expect(container.querySelector('img')?.src).toBe('https://example.invalid/icon.png');
        expect(container.querySelector<HTMLDivElement>('div[aria-hidden]')?.style.backgroundImage)
            .toContain('https://example.invalid/image.png');
        render(url);
        expect(fetchPreview).toHaveBeenCalledExactlyOnceWith(url, expect.any(AbortSignal));
    });

    it('reads cached URLs immediately when switching back without refetch or remount', async () => {
        const first = uniqueUrl();
        const second = uniqueUrl();
        fetchPreview.mockImplementation(url => Promise.resolve(preview(url, url === first ? 'First' : 'Second')));
        await act(async () => { render(first); await Promise.resolve(); });
        const anchor = container.querySelector('a');
        await act(async () => { render(second); await Promise.resolve(); });
        render(first);
        expect(container.querySelector('a')).toBe(anchor);
        expect(container.textContent).toContain('First');
        expect(container.textContent).not.toContain('Second');
        expect(container.querySelector('.animate-spin')).toBeNull();
        expect(fetchPreview).toHaveBeenCalledTimes(2);
    });

    it('aborts a replaced URL and ignores its late response, including the cache', async () => {
        const first = uniqueUrl();
        const second = uniqueUrl();
        const late = deferredPreview();
        const current = deferredPreview();
        fetchPreview.mockReturnValueOnce(late.promise).mockReturnValueOnce(current.promise);
        render(first);
        const signal = fetchPreview.mock.calls[0]?.[1];
        const anchor = container.querySelector('a');
        render(second);
        expect(signal?.aborted).toBe(true);
        await act(async () => { late.resolve(preview(first, 'Cancelled')); await late.promise; });
        expect(container.textContent).toContain('Loading preview…');
        expect(container.textContent).not.toContain('Cancelled');
        await act(async () => { current.resolve(preview(second, 'Current')); await current.promise; });
        expect(container.querySelector('a')).toBe(anchor);
        expect(container.textContent).toContain('Current');
        const retry = deferredPreview();
        fetchPreview.mockReturnValueOnce(retry.promise);
        render(first);
        expect(fetchPreview).toHaveBeenCalledTimes(3);
        expect(container.textContent).toContain('Loading preview…');
    });

    it('ignores stale failures and keeps the latest request loading', async () => {
        const late = deferredPreview();
        const current = deferredPreview();
        fetchPreview.mockReturnValueOnce(late.promise).mockReturnValueOnce(current.promise);
        render(uniqueUrl());
        render(uniqueUrl());
        await act(async () => { late.reject(new Error('late failure')); await late.promise.catch(() => undefined); });
        expect(container.textContent).toContain('Loading preview…');
        expect(container.textContent).not.toContain("Couldn't load");
        await act(async () => { current.resolve(preview('current', 'Current')); await current.promise; });
        expect(container.textContent).toContain('Current');
    });

    it('shows the existing translated error for a failed uncached preview', async () => {
        const request = deferredPreview();
        fetchPreview.mockReturnValue(request.promise);
        render(uniqueUrl());
        await act(async () => { request.reject(new Error('fixture error')); await request.promise.catch(() => undefined); });
        expect(container.textContent).toContain("Couldn't load the preview.");
        expect(container.querySelector('.animate-spin')).toBeNull();
    });

    it('retains the legacy previous-preview fallback after a changed URL fails', async () => {
        const first = uniqueUrl();
        fetchPreview.mockResolvedValueOnce(preview(first, 'Retained preview'));
        await act(async () => { render(first); await Promise.resolve(); });
        const request = deferredPreview();
        fetchPreview.mockReturnValueOnce(request.promise);
        render(uniqueUrl());
        expect(container.querySelector<HTMLDivElement>('div[aria-hidden]')?.style.backgroundImage)
            .toContain('image.png');
        await act(async () => { request.reject(new Error('failure')); await request.promise.catch(() => undefined); });
        expect(container.textContent).toContain('Retained preview');
        render('');
        expect(container.textContent).toContain('Retained preview');
        expect(container.querySelector('.animate-spin')).toBeNull();
    });

    it('cancels when the translation changes and uses the latest error translation', async () => {
        const first = deferredPreview();
        const second = deferredPreview();
        const url = uniqueUrl();
        fetchPreview.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        render(url);
        const signal = fetchPreview.mock.calls[0]?.[1];
        translations.t = (_key, fallback) => `CA ${fallback}`;
        render(url);
        expect(signal?.aborted).toBe(true);
        await act(async () => { second.reject(new Error('error')); await second.promise.catch(() => undefined); });
        expect(container.textContent).toContain("CA Couldn't load the preview.");
    });

    it('aborts on unmount without caching a late successful response', async () => {
        const request = deferredPreview();
        const url = uniqueUrl();
        fetchPreview.mockReturnValueOnce(request.promise);
        render(url);
        const signal = fetchPreview.mock.calls[0]?.[1];
        act(() => { root.render(null); });
        expect(signal?.aborted).toBe(true);
        await act(async () => { request.resolve(preview(url)); await request.promise; });
        fetchPreview.mockReturnValueOnce(deferredPreview().promise);
        render(url);
        expect(fetchPreview).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Loading preview…');
    });

    it('survives StrictMode effect replay without publishing the cancelled request', async () => {
        const first = deferredPreview();
        const second = deferredPreview();
        const url = uniqueUrl();
        fetchPreview.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        act(() => { root.render(<StrictMode><LinkCardBlock block={{ props: { url } }} /></StrictMode>); });
        expect(fetchPreview.mock.calls[0]?.[1]?.aborted).toBe(true);
        await act(async () => { second.resolve(preview(url, 'Strict current')); await second.promise; });
        await act(async () => { first.resolve(preview(url, 'Strict obsolete')); await first.promise; });
        expect(container.textContent).toContain('Strict current');
        expect(container.textContent).not.toContain('Strict obsolete');
    });
});
