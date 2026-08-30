import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ACTIVE_VAULT_SLUG_KEY,
    storageSet,
} from '../../shared/api/vault-context';
import { fetchVaultPagePreview } from '../../shared/api/vaults';
import {
    GalleryContentPreview,
    GalleryOpenButton,
} from './GalleryCardPreview';
import { getGalleryMarkdown } from './galleryCardPreviewUtils';

const testState = vi.hoisted(() => ({
    translate: (key: string, options?: { defaultValue?: string }): string => (
        options?.defaultValue || key
    ),
}));

vi.mock('../../shared/api/vaults', () => ({
    fetchVaultPagePreview: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: testState.translate }),
}));

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

interface MountedRoot {
    readonly container: HTMLDivElement;
    readonly root: Root;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;
const fetchVaultPagePreviewMock = vi.mocked(fetchVaultPagePreview);
const mountedRoots: MountedRoot[] = [];

beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    fetchVaultPagePreviewMock.mockReset();
    storageSet(ACTIVE_VAULT_SLUG_KEY, 'principal');
});

afterEach(() => {
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) break;
        act(() => {
            mounted.root.unmount();
        });
        mounted.container.remove();
    }
    storageSet(ACTIVE_VAULT_SLUG_KEY, '');
});

async function render(element: ReactElement): Promise<HTMLDivElement> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    await act(async () => {
        root.render(element);
        await Promise.resolve();
    });
    return container;
}

describe('GalleryCardPreview', () => {
    it('reads opaque Markdown with native coercion while preserving metadata and failures', () => {
        const content = { prefix: 'Native', toString() { return `${this.prefix} content`; } };
        const metadata: Record<string, unknown> = { description: content };
        metadata.self = metadata;
        const note = { title: 42, content, metadata };
        expect(getGalleryMarkdown(note)).toBe('Native content');
        expect(getGalleryMarkdown({ metadata })).toBe('Native content');
        expect(note.content).toBe(content);
        expect(metadata.self).toBe(metadata);
        expect(getGalleryMarkdown({ metadata: null })).toBe('');
        const failure = new Error('native coercion failed');
        expect(() => getGalleryMarkdown({ content: { toString(): never { throw failure; } } })).toThrow(failure);
    });

    it('prefers full Markdown over a shortened excerpt', () => {
        expect(getGalleryMarkdown({ body_md: 'Full body', excerpt: 'Short excerpt' })).toBe('Full body');
        expect(getGalleryMarkdown({ content: 'Stored content', excerpt: 'Short excerpt' })).toBe('Stored content');
    });

    it('renders managed Markdown without exposing comments and keeps wikilinks navigable', async () => {
        const onNoteSelect = vi.fn<(pageId?: string | null) => void>();
        const parentClick = vi.fn<() => void>();
        const targetId = '2bb611b6-3d66-4be5-b8c0-381c60834361';
        const fifthId = 'c3f95019-8d44-4ef2-8d7d-0ebc6c2a47ce';
        fetchVaultPagePreviewMock.mockResolvedValueOnce({
            body_md: `<!-- gnosi:llm-wiki:start resource:source-page -->\n1. [[${targetId}|Definition]]\n2. [[${fifthId}|Difference]]\n<!-- gnosi:llm-wiki:end resource:source-page -->`,
            excerpt: '',
            id: 'source-page',
            title: 'Index',
        });
        const container = await render(
            <div onClick={parentClick}>
                <GalleryContentPreview
                    note={{
                        id: 'source-page',
                        title: 'Index',
                        content: `<!-- gnosi:llm-wiki:start resource:source-page -->\n1. [[${targetId}|Definition]]\n2. [[${fifthId}|Diffe`,
                    }}
                    idToTitle={{ [targetId]: 'Definition', [fifthId]: 'Difference' }}
                    onNoteSelect={onNoteSelect}
                />
            </div>,
        );

        await act(async () => {
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 0);
            });
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(container.textContent).toContain('Definition');
        expect(container.textContent).toContain('Difference');
        expect(container.textContent).not.toContain(`[[${fifthId}`);
        expect(container.textContent).not.toContain('gnosi:llm-wiki');
        expect(container.querySelector('ol')).not.toBeNull();
        const contentSource = container.querySelector('[data-gallery-content-source]');
        if (!(contentSource instanceof HTMLElement)) {
            throw new Error('Missing gallery content source');
        }
        expect(contentSource.dataset.galleryContentSource).toBe('full');
        const previewCall = fetchVaultPagePreviewMock.mock.calls.at(0);
        if (!previewCall) throw new Error('Missing page-preview request');
        expect(previewCall[0]).toBe('source-page');
        expect(previewCall[1]).toEqual({ full: true });
        expect(previewCall[2]).toBeInstanceOf(AbortSignal);

        const wikilink = container.querySelector('[data-wikilink-target]');
        if (!(wikilink instanceof HTMLElement)) throw new Error('Missing wikilink');
        await act(async () => {
            wikilink.dispatchEvent(
                new MouseEvent('click', { bubbles: true, button: 0 }),
            );
            await Promise.resolve();
        });

        expect(onNoteSelect).toHaveBeenCalledWith(targetId);
        expect(parentClick).not.toHaveBeenCalled();
    });

    it('uses a native new-tab link without opening the card', async () => {
        const parentClick = vi.fn<() => void>();
        const container = await render(
            <div onClick={parentClick}>
                <GalleryOpenButton pageId="page/id" />
            </div>,
        );

        const link = container.querySelector('a');
        if (!(link instanceof HTMLAnchorElement)) throw new Error('Missing open-page link');
        act(() => {
            link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(link.href).toBe(
            'http://localhost:3000/@principal/knowledge/page/page%2Fid',
        );
        expect(link.target).toBe('_blank');
        expect(link.rel).toBe('noopener noreferrer');
        expect(parentClick).not.toHaveBeenCalled();
    });
});
