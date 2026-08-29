import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InsertContentModal } from './InsertContentModal';


type UploadFile = typeof import('../../shared/api/vault-content')['uploadVaultInsertFile'];
type LinkFile = typeof import('../../shared/api/vault-content')['linkExistingVaultFile'];
type RegisterFile = typeof import('../../shared/api/vault-content')['registerLocalVaultFile'];


interface VaultMediaItem {
    readonly filename: string;
    readonly kind: string;
    readonly url: string;
}
interface MockMediaPickerProps {
    readonly onSelect: (item: VaultMediaItem) => void;
}
interface MockFilesystemPickerProps {
    readonly initialQuery?: string;
    readonly isOpen: boolean;
    readonly mode?: 'any' | 'file' | 'folder';
    readonly onClose: () => void;
    readonly onSelect: (path: string, metadata: { readonly isDir: boolean }) => void;
    readonly onSelectMany?: ((entries: Array<{ readonly isDir: boolean; readonly path: string }>) => void) | null;
}
interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}


interface MountedRoot {
    readonly container: HTMLDivElement;
    readonly root: Root;
}


const apiMocks = vi.hoisted(() => ({
    link: vi.fn<LinkFile>(),
    register: vi.fn<RegisterFile>(),
    upload: vi.fn<UploadFile>(),
}));


const toastMocks = vi.hoisted(() => ({
    error: vi.fn<(message: string) => void>(),
}));


vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));


vi.mock('../../hooks/useModalKeyboard', () => ({
    useModalKeyboard: vi.fn(),
}));


vi.mock('../../lib/toast', () => ({
    toast: { error: toastMocks.error },
}));


vi.mock('../../shared/api/vault-content', () => ({
    linkExistingVaultFile: apiMocks.link,
    registerLocalVaultFile: apiMocks.register,
    uploadVaultInsertFile: apiMocks.upload,
}));


vi.mock('./markdown-mapper', () => ({
    fileUrlToSentinel: (href: string) => href.replace(
        /^file:\/\//i,
        'https://gnosi-file-protocol.local',
    ),
}));


vi.mock('./MediaPicker', () => ({
    MediaPicker: ({ onSelect }: MockMediaPickerProps) => (
        <div>
            <label>
                Vault search
                <input aria-label="Vault search" />
            </label>
            <button
                onClick={() => {
                    onSelect({
                        filename: 'paper.pdf',
                        kind: 'pdf',
                        url: '/api/vault/media/paper.pdf',
                    });
                }}
                type="button"
            >
                Pick Vault PDF
            </button>
        </div>
    ),
}));


vi.mock('../FilesystemPickerModal', () => ({
    FilesystemPickerModal: ({
        initialQuery = '',
        isOpen,
        mode = 'folder',
        onClose,
        onSelect,
        onSelectMany,
    }: MockFilesystemPickerProps) => isOpen ? (
        <div data-picker-mode={mode}>
            <span>{initialQuery}</span>
            {mode === 'folder' ? (
                <button
                    onClick={() => {
                        onSelect('/Users/ismael/Documents', { isDir: true });
                    }}
                    type="button"
                >
                    Choose destination
                </button>
            ) : (
                <>
                    <button
                        onClick={() => {
                            onSelect('/Users/ismael/report.pdf', { isDir: false });
                        }}
                        type="button"
                    >
                        Pick local file
                    </button>
                    <button
                        onClick={() => {
                            onSelect('/Users/ismael/Archive', { isDir: true });
                        }}
                        type="button"
                    >
                        Pick local folder
                    </button>
                    <button
                        onClick={() => {
                            onSelectMany?.([
                                { isDir: false, path: '/Users/ismael/report.pdf' },
                                { isDir: true, path: '/Users/ismael/Archive' },
                            ]);
                        }}
                        type="button"
                    >
                        Pick local batch
                    </button>
                </>
            )}
            <button onClick={onClose} type="button">Close picker</button>
        </div>
    ) : null,
}));


const mountedRoots: MountedRoot[] = [];
const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;


function translate(
    key: string,
    options?: string | Readonly<Record<string, unknown>>,
): string {
    if (typeof options === 'string') return options;
    const fallback = typeof options?.defaultValue === 'string'
        ? options.defaultValue
        : key;
    return fallback.replace(/{{(\w+)}}/g, (match, token: string) => {
        const value = options?.[token];
        if (typeof value === 'string') return value;
        if (typeof value === 'number') return value.toString();
        return match;
    });
}


async function renderModal(element: ReactElement): Promise<HTMLDivElement> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });
    await act(async () => {
        root.render(element);
        await Promise.resolve();
    });
    return container;
}


function findButton(container: ParentNode, label: string): HTMLButtonElement {
    const button = [...container.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.includes(label));
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing button: ${label}`);
    }
    return button;
}


function findInput(container: ParentNode, selector: string): HTMLInputElement {
    const input = container.querySelector(selector);
    if (!(input instanceof HTMLInputElement)) {
        throw new Error(`Missing input: ${selector}`);
    }
    return input;
}


function setInputValue(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
    )?.set?.bind(input);
    if (!setter) throw new Error('Missing native input value setter');
    setter(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}


async function click(button: HTMLButtonElement): Promise<void> {
    await act(async () => {
        button.click();
        await Promise.resolve();
        await Promise.resolve();
    });
}


beforeEach(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    apiMocks.upload.mockResolvedValue({ path: '/Vault/Assets/report.pdf', url: '/api/vault/assets/report.pdf' });
    apiMocks.link.mockResolvedValue({ path: '/Vault/Library/report.pdf', url: '/api/vault/library/report.pdf' });
    apiMocks.register.mockResolvedValue({
        extension: '.pdf',
        kind: 'pdf',
        name: 'report.pdf',
        path: '/Users/ismael/report.pdf',
        size: 1024,
        token: 'token',
        url: '/api/vault/local-file/token',
    });
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
    delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    vi.clearAllMocks();
});


function readableFile(name: string): File {
    const file = new File(['content'], name, { type: 'application/pdf' });
    const readableSlice = new Blob(['content']);
    Object.defineProperty(readableSlice, 'arrayBuffer', {
        configurable: true,
        value: () => Promise.resolve(new ArrayBuffer(7)),
    });
    vi.spyOn(file, 'slice').mockReturnValue(readableSlice);
    return file;
}


async function chooseUpload(container: ParentNode, file: File): Promise<void> {
    const input = findInput(container, 'input[type="file"]');
    Object.defineProperty(input, 'files', {
        configurable: true,
        value: [file],
    });
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await Promise.resolve();
    });
}


describe('InsertContentModal', () => {
    it('stays unmounted while closed', async () => {
        const container = await renderModal(
            <InsertContentModal
                onClose={vi.fn()}
                onInsert={vi.fn()}
                open={false}
            />,
        );

        expect(container.childElementCount).toBe(0);
    });


    it('keeps Vault search, selection, preview and callbacks connected', async () => {
        const onClose = vi.fn<() => void>();
        const onInsert = vi.fn<(result: unknown) => void>();
        const container = await renderModal(
            <InsertContentModal onClose={onClose} onInsert={onInsert} open />,
        );

        expect(container.textContent).toContain('Insert content');
        expect(container.textContent).toContain('Vault');
        expect(container.textContent).toContain('Disc local');
        expect(container.textContent).toContain('Puja');
        expect(container.textContent).toContain('URL');
        const search = findInput(container, 'input[aria-label="Vault search"]');
        act(() => {
            setInputValue(search, 'paper');
        });
        expect(search.value).toBe('paper');

        await click(findButton(container, 'Pick Vault PDF'));
        expect(container.textContent).toContain('paper.pdf');
        expect(container.textContent).toContain('From the Vault');
        await click(findButton(container, 'Insert'));

        expect(onInsert).toHaveBeenCalledWith({
            imageMeta: undefined,
            kind: 'pdf',
            mode: 'link',
            name: 'paper.pdf',
            url: '/api/vault/media/paper.pdf',
        });
        expect(onClose).toHaveBeenCalledOnce();
    });


    it('detects and previews an external video before inserting a frame', async () => {
        const onInsert = vi.fn<(result: unknown) => void>();
        const container = await renderModal(
            <InsertContentModal onClose={vi.fn()} onInsert={onInsert} open />,
        );

        await click(findButton(container, 'URL'));
        const urlInput = findInput(container, 'input[type="url"]');
        act(() => {
            setInputValue(urlInput, 'https://www.youtube.com/watch?v=evidence');
        });
        expect(container.textContent).toContain('YouTube');
        expect(container.textContent).toContain('Embedded frame recommended');
        await click(findButton(container, 'Frame'));
        await click(findButton(container, 'Insert'));

        expect(onInsert).toHaveBeenCalledWith({
            imageMeta: undefined,
            kind: 'youtube',
            mode: 'frame',
            name: 'watch',
            url: 'https://www.youtube.com/watch?v=evidence',
        });
    });


    it('registers local batches and preserves folder sentinels', async () => {
        const onInsert = vi.fn<(result: unknown) => void>();
        const container = await renderModal(
            <InsertContentModal
                fileField={{
                    fileMode: 'upload',
                    namePattern: '',
                    propertyName: 'attachments',
                    storageFolder: 'library',
                }}
                onClose={vi.fn()}
                onInsert={onInsert}
                open
                tableId="papers"
            />,
        );

        await click(findButton(container, 'Disc local'));
        await click(findButton(container, 'Open the file browser'));
        await click(findButton(document.body, 'Pick local batch'));
        expect(container.textContent).toContain('/Users/ismael/report.pdf');
        expect(container.textContent).toContain('/Users/ismael/Archive');
        await click(findButton(container, 'Insert'));

        expect(apiMocks.link).toHaveBeenCalledWith('/Users/ismael/report.pdf', '');
        expect(onInsert).toHaveBeenCalledWith({
            items: [
                {
                    kind: 'pdf',
                    name: 'report.pdf',
                    url: '/api/vault/library/report.pdf',
                },
                {
                    kind: 'folder',
                    name: 'Archive',
                    url: 'https://gnosi-file-protocol.local/Users/ismael/Archive',
                },
            ],
            kind: 'file',
            mode: 'link',
            urls: [
                '/api/vault/library/report.pdf',
                'https://gnosi-file-protocol.local/Users/ismael/Archive',
            ],
        });
    });


    it('asks once for a free destination and uploads through the typed API', async () => {
        const onInsert = vi.fn<(result: unknown) => void>();
        const container = await renderModal(
            <InsertContentModal
                fileField={{
                    fileMode: 'upload',
                    namePattern: '{title}',
                    propertyName: 'attachments',
                    storageFolder: 'free',
                }}
                onClose={vi.fn()}
                onInsert={onInsert}
                open
                rowMetadata={{ title: 'Evidence' }}
                tableId="papers"
            />,
        );
        const file = readableFile('report.pdf');

        await chooseUpload(container, file);
        await click(findButton(container, 'Insert'));
        await click(findButton(document.body, 'Choose destination'));

        expect(apiMocks.upload).toHaveBeenCalledOnce();
        const uploadCall = apiMocks.upload.mock.calls[0];
        if (!uploadCall) throw new Error('Missing upload call');
        expect(uploadCall[0]).toBe(file);
        expect(uploadCall[1]).toMatchObject({
            destFolder: '/Users/ismael/Documents',
            propertyName: 'attachments',
            storageFolder: 'free',
            tableId: 'papers',
            targetName: 'Evidence',
        });
        expect(onInsert).toHaveBeenCalledWith({
            imageMeta: undefined,
            kind: 'pdf',
            mode: 'link',
            name: 'report.pdf',
            url: '/api/vault/assets/report.pdf',
        });
    });


    it('saves image metadata without replacing the current image', async () => {
        const onInsert = vi.fn<(result: unknown) => void>();
        const container = await renderModal(
            <InsertContentModal
                imageField
                initialImageMeta={{ alt: 'Old alt', src: 'Images/photo.jpg' }}
                onClose={vi.fn()}
                onInsert={onInsert}
                open
            />,
        );
        const altInput = findInput(container, 'input[placeholder="Alt text (accessibility)"]');
        act(() => {
            setInputValue(altInput, 'New alt');
        });
        await click(findButton(container, 'Save'));

        expect(onInsert).toHaveBeenCalledWith({
            imageMeta: { alt: 'New alt', src: 'Images/photo.jpg' },
            metadataOnly: true,
        });
    });


    it('reports unreadable uploads and returns the user to local selection', async () => {
        apiMocks.upload.mockRejectedValue(new Error('unreadable-file'));
        const container = await renderModal(
            <InsertContentModal onClose={vi.fn()} onInsert={vi.fn()} open />,
        );

        await click(findButton(container, 'Puja'));
        await chooseUpload(container, readableFile('cloud.pdf'));
        await click(findButton(container, 'Insert'));

        expect(toastMocks.error).toHaveBeenCalledWith(
            'This file is online-only. Locate it in "Local disk" and Gnosi will download it automatically.',
        );
        expect(container.textContent).toContain('Locate “cloud.pdf” on disk');
    });
});
