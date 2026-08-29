import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    FilesystemBrowseResult,
    FilesystemSearchResult,
    NativePickAvailability,
    NativePickInput,
    NativePickResult,
} from '../shared/api/system';
import { removeStorage } from '../shared/platform/browser-storage';
import { FilesystemPickerModal } from './FilesystemPickerModal';
import { FILESYSTEM_PICKER_LAST_PATH_KEY } from './filesystem-picker/filesystemPickerModel';
import type { FilesystemPickerModalProps } from './filesystem-picker/filesystemPickerTypes';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const testState = vi.hoisted(() => ({
    browseFilesystem: vi.fn<(path?: string) => Promise<FilesystemBrowseResult>>(),
    fetchNativePickAvailability: vi.fn<() => Promise<NativePickAvailability>>(),
    pickNativeFilesystemEntry: vi.fn<(
        input?: Partial<NativePickInput>,
    ) => Promise<NativePickResult>>(),
    searchFilesystem: vi.fn<(
        input: { readonly limit?: number; readonly query: string },
    ) => Promise<FilesystemSearchResult>>(),
    translate: (
        key: string,
        values?: Readonly<Record<string, number | string>>,
    ): string => {
        let translated = values?.defaultValue ?? key;
        if (typeof translated === 'number') translated = translated.toString();
        for (const [name, value] of Object.entries(values ?? {})) {
            const replacement = typeof value === 'number' ? value.toString() : value;
            translated = translated.replaceAll(`{{${name}}}`, replacement);
        }
        return translated;
    },
}));

vi.mock('../shared/api/system', () => ({
    browseFilesystem: testState.browseFilesystem,
    fetchNativePickAvailability: testState.fetchNativePickAvailability,
    pickNativeFilesystemEntry: testState.pickNativeFilesystemEntry,
    searchFilesystem: testState.searchFilesystem,
}));

vi.mock('../hooks/useModalKeyboard', () => ({
    useModalKeyboard: () => undefined,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: testState.translate,
    }),
}));

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;

const browseResult = (files: string[] = ['report.pdf', 'notes.txt']): FilesystemBrowseResult => ({
    current_path: '/internal/current',
    directories: ['Archive'],
    display_path: '/Users/ada/Documents',
    files,
    roots: {
        home: '/Users/ada',
        root: '/',
        vault: '/Users/ada/Vault',
    },
});

async function flushAsyncWork(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

function findButton(label: string): HTMLButtonElement {
    const button = [...document.body.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.trim() === label);
    if (!(button instanceof HTMLButtonElement)) {
        throw new TypeError(`Missing button: ${label}`);
    }
    return button;
}

function findOption(label: string): HTMLDivElement {
    const labelElement = [...document.body.querySelectorAll('[role="option"]')]
        .find((candidate) => candidate.textContent.includes(label));
    if (!(labelElement instanceof HTMLDivElement)) {
        throw new TypeError(`Missing option: ${label}`);
    }
    return labelElement;
}

describe('FilesystemPickerModal', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        testState.browseFilesystem.mockReset();
        testState.fetchNativePickAvailability.mockReset();
        testState.pickNativeFilesystemEntry.mockReset();
        testState.searchFilesystem.mockReset();
        testState.browseFilesystem.mockResolvedValue(browseResult());
        testState.fetchNativePickAvailability.mockResolvedValue({
            available: false,
            reason: null,
        });
        testState.pickNativeFilesystemEntry.mockResolvedValue({ status: 'cancelled' });
        testState.searchFilesystem.mockResolvedValue({
            error: null,
            results: [],
            truncated: false,
        });
        removeStorage(FILESYSTEM_PICKER_LAST_PATH_KEY);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        removeStorage(FILESYSTEM_PICKER_LAST_PATH_KEY);
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
        vi.useRealTimers();
    });

    async function renderPicker(
        overrides: Partial<FilesystemPickerModalProps> = {},
    ): Promise<{
        onSelect: ReturnType<typeof vi.fn<FilesystemPickerModalProps['onSelect']>>;
        onSelectMany: ReturnType<typeof vi.fn<NonNullable<FilesystemPickerModalProps['onSelectMany']>>>;
    }> {
        const onSelect = vi.fn<FilesystemPickerModalProps['onSelect']>();
        const onSelectMany = vi.fn<NonNullable<FilesystemPickerModalProps['onSelectMany']>>();
        const props: FilesystemPickerModalProps = {
            isOpen: true,
            mode: 'file',
            onClose: vi.fn<() => void>(),
            onSelect,
            preferNative: false,
            ...overrides,
        };
        await act(async () => {
            root.render(<FilesystemPickerModal {...props} />);
            await flushAsyncWork();
        });
        return { onSelect, onSelectMany };
    }

    it('returns a browsed file through the existing single-selection contract', async () => {
        const { onSelect } = await renderPicker();

        act(() => {
            findOption('report.pdf').click();
        });

        expect(onSelect.mock.calls).toEqual([
            ['/Users/ada/Documents/report.pdf', { isDir: false }],
        ]);
    });

    it('keeps checked files across the batch and confirms them together', async () => {
        const onSelectMany = vi.fn<NonNullable<FilesystemPickerModalProps['onSelectMany']>>();
        await renderPicker({ mode: 'any', onSelectMany });

        act(() => {
            findOption('report.pdf').click();
        });
        act(() => {
            findOption('notes.txt').click();
        });
        act(() => {
            findButton('Select 2 files').click();
        });

        expect(onSelectMany.mock.calls).toEqual([[[
            { isDir: false, path: '/Users/ada/Documents/report.pdf' },
            { isDir: false, path: '/Users/ada/Documents/notes.txt' },
        ]]]);
    });

    it('searches globally after the debounce and selects the returned host path', async () => {
        vi.useFakeTimers();
        testState.searchFilesystem.mockResolvedValue({
            error: null,
            results: [{
                is_dir: false,
                name: 'indexed.pdf',
                path: '/Volumes/Research/indexed.pdf',
            }],
            truncated: false,
        });
        const { onSelect } = await renderPicker({ initialQuery: 'indexed' });

        await act(async () => {
            vi.advanceTimersByTime(300);
            await flushAsyncWork();
        });
        act(() => {
            findOption('indexed.pdf').click();
        });

        expect(testState.searchFilesystem.mock.calls).toEqual([[
            { limit: 200, query: 'indexed' },
        ]]);
        expect(onSelect.mock.calls).toEqual([[
            '/Volumes/Research/indexed.pdf',
            { isDir: false },
        ]]);
    });

    it('auto-opens the native picker and preserves mixed batch metadata', async () => {
        testState.fetchNativePickAvailability.mockResolvedValue({
            available: true,
            reason: null,
        });
        testState.pickNativeFilesystemEntry.mockResolvedValue({
            entries: [
                { is_dir: true, path: '/Users/ada/Folder' },
                { is_dir: false, path: '/Users/ada/file.pdf' },
            ],
            is_dir: true,
            path: '/Users/ada/Folder',
            status: 'ok',
        });
        const onSelectMany = vi.fn<NonNullable<FilesystemPickerModalProps['onSelectMany']>>();

        await renderPicker({ mode: 'any', onSelectMany, preferNative: true });
        await act(async () => {
            await flushAsyncWork();
        });

        expect(testState.pickNativeFilesystemEntry.mock.calls).toEqual([[
            {
                mode: 'any',
                multiple: true,
                prompt: 'fs_picker.title_any',
            },
        ]]);
        expect(onSelectMany.mock.calls).toEqual([[[
            { isDir: true, path: '/Users/ada/Folder' },
            { isDir: false, path: '/Users/ada/file.pdf' },
        ]]]);
    });
});
