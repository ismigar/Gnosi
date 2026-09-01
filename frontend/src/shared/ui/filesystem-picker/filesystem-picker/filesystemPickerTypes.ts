import type { KeyboardEvent, RefObject } from 'react';

import type {
    FilesystemBrowseResult,
    FilesystemSearchResult,
} from '../../../api/system';

export type FilesystemPickerMode = 'any' | 'file' | 'folder';

export interface FilesystemPickerSelection {
    readonly isDir: boolean;
    readonly path: string;
}

export interface FilesystemPickerModalProps {
    readonly initialPath?: string;
    readonly initialQuery?: string;
    readonly isOpen: boolean;
    readonly mode?: FilesystemPickerMode;
    readonly onClose: () => void;
    readonly onSelect: (
        absoluteHostPath: string,
        metadata: { readonly isDir: boolean },
    ) => void;
    readonly onSelectMany?: ((entries: FilesystemPickerSelection[]) => void) | null;
    readonly preferNative?: boolean;
}

export type FilesystemRoots = FilesystemBrowseResult['roots'];
export type FilesystemSearchEntry = FilesystemSearchResult['results'][number];

export type FilesystemPickerItem =
    | { readonly kind: 'dir'; readonly name: string }
    | { readonly kind: 'file'; readonly name: string }
    | { readonly data: FilesystemSearchEntry; readonly kind: 'search' };

export type PickerTranslationValues = Readonly<Record<string, number | string>>;
export type PickerTranslate = (
    key: string,
    values?: PickerTranslationValues,
) => string;

export interface FilesystemPickerController {
    readonly canMulti: boolean;
    readonly canPickFolder: boolean;
    readonly checkedPaths: readonly string[];
    readonly currentPath: string;
    readonly displayPath: string;
    readonly error: string;
    readonly goUp: () => void;
    readonly handleConfirmMany: () => void;
    readonly handleListKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
    readonly handleNativePick: () => void;
    readonly handleSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
    readonly handleSearchQueryChange: (value: string) => void;
    readonly handleSelectCurrentFolder: () => void;
    readonly highlightedIndex: number;
    readonly highlightItem: (index: number) => void;
    readonly isSearching: boolean;
    readonly isChecked: (path: string) => boolean;
    readonly itemFilePath: (item: FilesystemPickerItem | undefined) => string | null;
    readonly items: readonly FilesystemPickerItem[];
    readonly loading: boolean;
    readonly nativeAvailable: boolean;
    readonly nativeError: string;
    readonly nativePicking: boolean;
    readonly openItem: (index: number) => void;
    readonly openItemNow: (index: number) => void;
    readonly openPath: (path: string) => void;
    readonly roots: FilesystemRoots | null;
    readonly searchPlaceholder: string;
    readonly searchQuery: string;
    readonly searchTruncated: boolean;
    readonly showFiles: boolean;
    readonly titleText: string;
    readonly tn: PickerTranslate;
}

export interface FilesystemPickerBindings {
    readonly controller: FilesystemPickerController;
    readonly itemRefs: RefObject<Array<HTMLDivElement | null>>;
    readonly listRef: RefObject<HTMLDivElement | null>;
    readonly modalRef: RefObject<HTMLDivElement | null>;
}
