import {
    defineStorageKey,
    readStorage,
    stringStorageCodec,
    writeStorage,
} from '../../../platform/browser-storage';
import type {
    FilesystemPickerItem,
    FilesystemSearchEntry,
} from './filesystemPickerTypes';

export const FILESYSTEM_PICKER_LAST_PATH_KEY = defineStorageKey(
    'gnosi.fsPicker.lastPath',
    stringStorageCodec,
);

export function readFilesystemPickerLastPath(): string {
    return readStorage(FILESYSTEM_PICKER_LAST_PATH_KEY) ?? '';
}

export function saveFilesystemPickerLastPath(path: string): void {
    if (path) writeStorage(FILESYSTEM_PICKER_LAST_PATH_KEY, path);
}

export function joinFilesystemPath(...parts: readonly string[]): string {
    return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

export function buildFilesystemPickerItems({
    directories,
    files,
    searchResults,
    showFiles,
}: {
    readonly directories: readonly string[];
    readonly files: readonly string[];
    readonly searchResults: readonly FilesystemSearchEntry[] | null;
    readonly showFiles: boolean;
}): FilesystemPickerItem[] {
    if (searchResults !== null) {
        return searchResults
            .filter((entry) => showFiles || entry.is_dir)
            .map((data) => ({ data, kind: 'search' }));
    }
    return [
        ...directories.map((name) => ({ kind: 'dir' as const, name })),
        ...(showFiles
            ? files.map((name) => ({ kind: 'file' as const, name }))
            : []),
    ];
}

export function filesystemPickerItemFilePath(
    item: FilesystemPickerItem | undefined,
    parentPath: string,
): string | null {
    if (!item) return null;
    if (item.kind === 'file') return joinFilesystemPath(parentPath, item.name);
    if (item.kind === 'search' && !item.data.is_dir) return item.data.path;
    return null;
}
