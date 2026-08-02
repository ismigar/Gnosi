import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    GalleryContentPreview,
    GalleryOpenButton,
} from './GalleryCardPreview';
import { getGalleryMarkdown } from './galleryCardPreviewUtils';

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
        const container = await render(
            <div onClick={parentClick}>
                <GalleryContentPreview
                    note={{
                        id: 'source-page',
                        title: 'Index',
                        content: `<!-- gnosi:llm-wiki:start resource:source-page -->\n1. [[${targetId}|Definition]]\n<!-- gnosi:llm-wiki:end resource:source-page -->`,
                    }}
                    idToTitle={{ [targetId]: 'Definition' }}
                    onNoteSelect={onNoteSelect}
                />
            </div>,
        );

        expect(container.textContent).toContain('Definition');
        expect(container.textContent).not.toContain('gnosi:llm-wiki');
        expect(container.querySelector('ol')).not.toBeNull();

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
