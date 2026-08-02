import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    GalleryContentPreview,
    GalleryOpenButton,
} from './GalleryCardPreview';
import { getGalleryMarkdown } from './galleryCardPreviewUtils';

vi.mock('axios', () => ({
    default: { get: vi.fn() },
}));

const mountedRoots = [];

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    while (mountedRoots.length > 0) {
        const { root, container } = mountedRoots.pop();
        await act(async () => root.unmount());
        container.remove();
    }
});

async function render(element) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    await act(async () => root.render(element));
    return container;
}

describe('GalleryCardPreview', () => {
    it('prefers full Markdown over a shortened excerpt', () => {
        expect(getGalleryMarkdown({ body_md: 'Full body', excerpt: 'Short excerpt' })).toBe('Full body');
        expect(getGalleryMarkdown({ content: 'Stored content', excerpt: 'Short excerpt' })).toBe('Stored content');
    });

    it('renders managed Markdown without exposing comments and keeps wikilinks navigable', async () => {
        const onNoteSelect = vi.fn();
        const parentClick = vi.fn();
        const targetId = '2bb611b6-3d66-4be5-b8c0-381c60834361';
        const fifthId = 'c3f95019-8d44-4ef2-8d7d-0ebc6c2a47ce';
        axios.get.mockResolvedValueOnce({
            data: {
                body_md: `<!-- gnosi:llm-wiki:start resource:source-page -->\n1. [[${targetId}|Definition]]\n2. [[${fifthId}|Difference]]\n<!-- gnosi:llm-wiki:end resource:source-page -->`,
            },
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
            await new Promise(resolve => setTimeout(resolve, 0));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(container.textContent).toContain('Definition');
        expect(container.textContent).toContain('Difference');
        expect(container.textContent).not.toContain(`[[${fifthId}`);
        expect(container.textContent).not.toContain('gnosi:llm-wiki');
        expect(container.querySelector('ol')).not.toBeNull();
        expect(container.querySelector('[data-gallery-content-source]').dataset.galleryContentSource).toBe('full');
        expect(axios.get).toHaveBeenCalledWith(
            '/api/vault/pages/source-page/preview?full=true',
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );

        await act(async () => {
            container.querySelector('[data-wikilink-target]').dispatchEvent(
                new MouseEvent('click', { bubbles: true, button: 0 }),
            );
            await Promise.resolve();
        });

        expect(onNoteSelect).toHaveBeenCalledWith(targetId);
        expect(parentClick).not.toHaveBeenCalled();
    });

    it('uses a native new-tab link without opening the card', async () => {
        const parentClick = vi.fn();
        const container = await render(
            <div onClick={parentClick}>
                <GalleryOpenButton pageId="page/id" />
            </div>,
        );

        await act(async () => {
            container.querySelector('a').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(container.querySelector('a').href).toBe('http://localhost:3000/vault/page/page%2Fid');
        expect(container.querySelector('a').target).toBe('_blank');
        expect(container.querySelector('a').rel).toBe('noopener noreferrer');
        expect(parentClick).not.toHaveBeenCalled();
    });
});
