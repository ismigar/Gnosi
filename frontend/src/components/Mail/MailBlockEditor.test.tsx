import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MailBlockEditor from './MailBlockEditor';


interface BlockFixture {
    readonly content: readonly unknown[];
    readonly id: string;
    readonly type: string;
}


interface UploadOptions {
    readonly uploadFile: (file: File) => Promise<string>;
}


const mocks = vi.hoisted(() => ({
    blocksToHTMLLossy: vi.fn(() => '<p>Changed</p>'),
    focus: vi.fn(),
    insertBlocks: vi.fn(),
    logError: vi.fn(),
    replaceBlocks: vi.fn(),
    setTextCursorPosition: vi.fn(),
    toast: Object.assign(vi.fn(), { error: vi.fn() }),
    transact: vi.fn(),
    tryParseHTMLToBlocks: vi.fn(),
    uploadFile: undefined as ((file: File) => Promise<string>) | undefined,
    uploadVaultAsset: vi.fn(),
    useCreateBlockNote: vi.fn(),
}));
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const emptyBlock: BlockFixture = { id: 'block-1', type: 'paragraph', content: [] };
const editor = {
    blocksToHTMLLossy: mocks.blocksToHTMLLossy,
    document: [emptyBlock],
    focus: mocks.focus,
    getTextCursorPosition: vi.fn(() => ({ block: emptyBlock })),
    insertBlocks: mocks.insertBlocks,
    pmSchema: { marks: { link: { create: vi.fn(() => ({ type: 'link-mark' })) } } },
    prosemirrorView: { hasFocus: vi.fn(() => false) },
    replaceBlocks: mocks.replaceBlocks,
    setTextCursorPosition: mocks.setTextCursorPosition,
    transact: mocks.transact,
    tryParseHTMLToBlocks: mocks.tryParseHTMLToBlocks,
};


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback ?? key,
    }),
}));

vi.mock('../../hooks/useTheme', () => ({
    useTheme: () => ({ effectiveTheme: 'light' }),
}));

vi.mock('../../lib/notifyError', () => ({
    logError: mocks.logError,
}));

vi.mock('../../lib/toast', () => ({
    toast: mocks.toast,
}));

vi.mock('../../shared/api/vault-specialized', () => ({
    uploadVaultAsset: mocks.uploadVaultAsset,
}));

vi.mock('@blocknote/react', () => ({
    useCreateBlockNote: (options: UploadOptions) => {
        mocks.uploadFile = options.uploadFile;
        mocks.useCreateBlockNote(options);
        return editor;
    },
}));

vi.mock('@blocknote/mantine', () => ({
    BlockNoteView: ({ onChange }: { readonly onChange: () => void }) => (
        <button data-testid="block-note-change" onClick={onChange} type="button">Editor</button>
    ),
}));


describe('MailBlockEditor', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        editor.document = [emptyBlock];
        mocks.tryParseHTMLToBlocks.mockReturnValue([
            { id: 'parsed', type: 'paragraph', content: [{ text: 'Hello' }] },
        ]);
        mocks.uploadVaultAsset.mockResolvedValue({ url: '/api/vault/assets/image.png' });
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        vi.clearAllMocks();
        mocks.uploadFile = undefined;
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('parses initial HTML and prepends the requested empty lines', () => {
        act(() => {
            root.render(
                <MailBlockEditor initialContent="<p>Hello</p>" prependEmptyLines={2} />,
            );
        });

        expect(mocks.tryParseHTMLToBlocks).toHaveBeenCalledWith('<p>Hello</p>');
        expect(mocks.replaceBlocks).toHaveBeenCalledWith(
            [emptyBlock],
            [{ id: 'parsed', type: 'paragraph', content: [{ text: 'Hello' }] }],
        );
        expect(mocks.insertBlocks).toHaveBeenCalledWith(
            [
                { type: 'paragraph', content: [] },
                { type: 'paragraph', content: [] },
            ],
            emptyBlock,
            'before',
        );
    });

    it('emits changed HTML once and suppresses identical output', () => {
        const onChange = vi.fn();
        act(() => {
            root.render(<MailBlockEditor initialContent="<p>Initial</p>" onChange={onChange} />);
        });
        const change = container.querySelector<HTMLButtonElement>('[data-testid="block-note-change"]');
        if (!change) throw new Error('BlockNote test view did not render');
        act(() => {
            change.click();
            change.click();
        });

        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenCalledWith('<p>Changed</p>');
    });

    it('redirects non-image uploads to mail attachments', async () => {
        const onAttachFile = vi.fn();
        act(() => {
            root.render(<MailBlockEditor onAttachFile={onAttachFile} />);
        });
        const uploadFile = mocks.uploadFile;
        if (!uploadFile) throw new Error('BlockNote upload handler was not configured');
        const attachment = new File(['pdf'], 'paper.pdf', { type: 'application/pdf' });

        await expect(uploadFile(attachment)).rejects.toThrow('redirected to attachments');
        expect(onAttachFile).toHaveBeenCalledWith(attachment);
        expect(mocks.uploadVaultAsset).not.toHaveBeenCalled();
    });

    it('uploads images for inline insertion', async () => {
        act(() => {
            root.render(<MailBlockEditor />);
        });
        const uploadFile = mocks.uploadFile;
        if (!uploadFile) throw new Error('BlockNote upload handler was not configured');
        const image = new File(['png'], 'cover.png', { type: 'image/png' });

        await expect(uploadFile(image)).resolves.toBe('/api/vault/assets/image.png');
        expect(mocks.uploadVaultAsset).toHaveBeenCalledWith(image);
    });
});
