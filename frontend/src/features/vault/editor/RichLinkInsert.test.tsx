import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { RichLinkInsertModal } from './RichLinkInsert';
import type { RichLinkEditor } from './rich-link/richLinkModel';


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: string | { defaultValue?: string }) => (
            typeof options === 'string'
                ? options
                : options?.defaultValue ?? key
        ),
    }),
}));


vi.mock('../../../shared/ui/filesystem-picker/FilesystemPickerModal', () => ({
    FilesystemPickerModal: () => null,
}));


vi.mock('../../../shared/notifications/toast', () => ({
    toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));


interface MountedRoot {
    readonly container: HTMLDivElement;
    readonly root: Root;
}


const mountedRoots: MountedRoot[] = [];


const render = (element: ReactElement): HTMLDivElement => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });
    act(() => {
        root.render(element);
    });
    return container;
};


const buttonByText = (container: HTMLElement, text: string): HTMLButtonElement => {
    const button = [...container.querySelectorAll('button')]
        .find((item) => item.textContent.includes(text));
    if (!button) throw new Error(`Button not rendered: ${text}`);
    return button;
};


const setInput = (input: HTMLInputElement, value: string): void => {
    const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
    );
    if (!descriptor?.set) throw new Error('Native input value setter unavailable');
    descriptor.set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
};


const createEditor = () => ({
    getSelectedText: vi.fn<() => string>(() => 'Selected text'),
    getTextCursorPosition: vi.fn<() => { block: unknown }>(() => ({
        block: { id: 'current' },
    })),
    insertBlocks: vi.fn<(
        blocks: readonly unknown[],
        referenceBlock: unknown,
        placement: 'after',
    ) => void>(),
    insertInlineContent: vi.fn<(content: unknown) => void>(),
}) satisfies RichLinkEditor;


beforeAll(() => {
    const reactTestEnvironment = globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
    };
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});


afterEach(() => {
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) continue;
        act(() => {
            mounted.root.unmount();
        });
        mounted.container.remove();
    }
    vi.clearAllMocks();
});


describe('RichLinkInsertModal', () => {
    it('inserts an external URL with the selected editor text', () => {
        const editor = createEditor();
        const container = render(
            <RichLinkInsertModal
                editor={editor}
                onClose={vi.fn()}
                open
            />,
        );
        const urlInput = container.querySelector<HTMLInputElement>('input[type="url"]');
        if (!urlInput) throw new Error('URL input not rendered');
        act(() => {
            setInput(urlInput, 'https://example.com/evidence');
        });
        act(() => {
            buttonByText(container, 'Insert link').click();
        });

        expect(editor.insertInlineContent).toHaveBeenCalledWith([{
            content: [{ styles: {}, text: 'Selected text', type: 'text' }],
            href: 'https://example.com/evidence',
            type: 'link',
        }]);
    });

    it('converts a local path into the persisted sentinel link', () => {
        const editor = createEditor();
        const container = render(
            <RichLinkInsertModal editor={editor} onClose={vi.fn()} open />,
        );
        act(() => {
            buttonByText(container, 'Local').click();
        });
        const pathInput = container.querySelector<HTMLInputElement>(
            'input[placeholder="/Users/.../document.pdf"]',
        );
        if (!pathInput) throw new Error('Local path input not rendered');
        act(() => {
            setInput(pathInput, '/Users/ismael/document.pdf');
        });
        act(() => {
            buttonByText(container, 'Insert link').click();
        });

        const insertedContent = editor.insertInlineContent.mock.calls[0]?.[0];
        expect(JSON.stringify(insertedContent)).toContain('gnosi-file-protocol.local');
        expect(JSON.stringify(insertedContent)).toContain('"type":"link"');
    });

    it('inserts an image block for an embeddable URL', () => {
        const editor = createEditor();
        const container = render(
            <RichLinkInsertModal editor={editor} onClose={vi.fn()} open />,
        );
        act(() => {
            buttonByText(container, 'Embed').click();
        });
        const urlInput = container.querySelector<HTMLInputElement>('input[type="url"]');
        if (!urlInput) throw new Error('Embed URL input not rendered');
        act(() => {
            setInput(urlInput, 'https://example.com/image.jpg');
        });
        const submitButton = urlInput.closest('form')
            ?.querySelector<HTMLButtonElement>('button[type="submit"]');
        if (!submitButton) throw new Error('Embed submit button not rendered');
        act(() => {
            submitButton.click();
        });

        expect(editor.insertBlocks).toHaveBeenCalledWith(
            [{ props: { url: 'https://example.com/image.jpg' }, type: 'image' }],
            { id: 'current' },
            'after',
        );
    });
});
