import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MermaidBlock, { type MermaidBlockProps } from './MermaidBlock';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback: string): string => fallback || key,
    }),
}));

function setTextarea(textarea: HTMLTextAreaElement, value: string): void {
    act(() => {
        const setValue = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value',
        )?.set?.bind(textarea);
        if (!setValue) throw new Error('Missing native textarea value setter');
        setValue(value);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

describe('MermaidBlock', () => {
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

    it('saves trimmed Mermaid source with the existing block update contract', async () => {
        const updateBlock = vi.fn<NonNullable<MermaidBlockProps['editor']>['updateBlock']>();
        const block = { props: { code: '' } };
        await act(async () => {
            root.render(<MermaidBlock block={block} editor={{ updateBlock }} />);
            await Promise.resolve();
        });

        const textarea = container.querySelector('textarea');
        if (!(textarea instanceof HTMLTextAreaElement)) {
            throw new Error('Missing Mermaid source editor');
        }
        setTextarea(textarea, '  graph TD\n  A --> B  ');
        act(() => {
            textarea.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                ctrlKey: true,
                key: 'Enter',
            }));
        });

        expect(updateBlock).toHaveBeenCalledWith(block, {
            props: { code: 'graph TD\n  A --> B' },
            type: 'mermaid',
        });
        expect(container.querySelector('textarea')).toBeNull();
    });
});
