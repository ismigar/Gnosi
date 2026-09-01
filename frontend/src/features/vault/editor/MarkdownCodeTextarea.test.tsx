/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarkdownCodeTextarea } from './MarkdownCodeTextarea';

const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;

describe('MarkdownCodeTextarea', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
    });

    it('keeps an empty Markdown document visible and focusable', () => {
        act(() => {
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
        if (!textarea) throw new Error('Expected Markdown textarea');
        expect(textarea.style.minHeight).toBe('500px');
        expect(textarea.getAttribute('aria-label')).toBe('Markdown source');
        expect(textarea.getAttribute('placeholder')).toBe('Write Markdown…');

        textarea.focus();
        expect(document.activeElement).toBe(textarea);
    });
});
