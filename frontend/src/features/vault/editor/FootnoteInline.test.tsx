import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FootnoteInline, { type FootnoteInlineProps } from './FootnoteInline';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback: string): string => fallback || key,
    }),
}));

describe('FootnoteInline', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('numbers nested footnotes and saves with the documented keyboard shortcut', async () => {
        const updateInlineContent = vi.fn<FootnoteInlineProps['updateInlineContent']>();
        await act(async () => {
            root.render(
                <FootnoteInline
                    editor={{
                        document: [{
                            content: [{ type: 'footnote', props: { id: 'first' } }],
                            children: [{
                                content: [{ type: 'footnote', props: { id: 'second' } }],
                            }],
                        }],
                    }}
                    inlineContent={{ props: { id: 'second', content: 'Nested note' } }}
                    updateInlineContent={updateInlineContent}
                />,
            );
            await Promise.resolve();
        });

        const mark = container.querySelector('sup');
        if (!(mark instanceof HTMLElement)) throw new Error('Missing footnote mark');
        expect(mark.textContent).toBe('[2]');
        act(() => {
            mark.click();
        });

        const textarea = document.querySelector('[data-gnosi-portal="footnote"] textarea');
        if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Missing footnote editor');
        expect(textarea.value).toBe('Nested note');
        act(() => {
            textarea.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                ctrlKey: true,
                key: 'Enter',
            }));
        });

        expect(updateInlineContent).toHaveBeenCalledWith({
            type: 'footnote',
            props: { id: 'second', content: 'Nested note' },
        });
        expect(document.querySelector('[data-gnosi-portal="footnote"]')).toBeNull();
    });
});
