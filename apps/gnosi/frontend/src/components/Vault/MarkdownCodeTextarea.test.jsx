/** @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarkdownCodeTextarea } from './MarkdownCodeTextarea';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('MarkdownCodeTextarea', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    it('keeps an empty Markdown document visible and focusable', async () => {
        await act(async () => {
            root.render(
                <MarkdownCodeTextarea
                    value=""
                    onChange={vi.fn()}
                    onKeyDown={vi.fn()}
                    ariaLabel="Markdown source"
                    placeholder="Write Markdown…"
                />,
            );
        });

        const textarea = container.querySelector('textarea');

        expect(textarea).not.toBeNull();
        expect(textarea.style.minHeight).toBe('500px');
        expect(textarea.getAttribute('aria-label')).toBe('Markdown source');
        expect(textarea.getAttribute('placeholder')).toBe('Write Markdown…');

        textarea.focus();
        expect(document.activeElement).toBe(textarea);
    });
});
