import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
    browseFilesystem,
    fetchNativePickAvailability,
    pickNativeFilesystemEntry,
    searchFilesystem,
} from '../../../api/system';
import {
    buildFilesystemPickerItems,
    filesystemPickerItemFilePath,
    joinFilesystemPath,
    readFilesystemPickerLastPath,
    saveFilesystemPickerLastPath,
} from './filesystemPickerModel';
import type {
    FilesystemPickerBindings,
    FilesystemPickerController,
    FilesystemPickerMode,
    FilesystemPickerModalProps,
    FilesystemSearchEntry,
    PickerTranslate,
} from './filesystemPickerTypes';

interface OpenFilesystemPickerOptions {
    readonly initialPath: string;
    readonly initialQuery: string;
    readonly mode: FilesystemPickerMode;
    readonly onSelect: FilesystemPickerModalProps['onSelect'];
    readonly onSelectMany: NonNullable<FilesystemPickerModalProps['onSelectMany']> | null;
    readonly preferNative: boolean;
}

interface QueryState {
    readonly initialQuery: string;
    readonly value: string;
}

function scrollPickerItemIntoView(element: HTMLDivElement | null | undefined): void {
    if (!element) return;
    const scrollIntoView: unknown = Reflect.get(element, 'scrollIntoView');
    if (typeof scrollIntoView !== 'function') return;
    Reflect.apply(scrollIntoView, element, [{ block: 'nearest' }]);
}

export function useFilesystemPicker({
    initialPath,
    initialQuery,
    mode,
    onSelect,
    onSelectMany,
    preferNative,
}: OpenFilesystemPickerOptions): FilesystemPickerBindings {
    const { t } = useTranslation();
    const tn: PickerTranslate = useCallback((key, values) => (
        values === undefined
            ? t(`fs_picker.${key}`)
            : t(`fs_picker.${key}`, values)
    ), [t]);
    const localizeError = useCallback((data: {
        readonly error?: string | null;
        readonly error_code?: string | null;
    }): string => {
        const fallback = data.error ?? '';
        return data.error_code
            ? tn(`errors.${data.error_code}`, { defaultValue: fallback })
            : fallback;
    }, [tn]);

    const [openingPath] = useState(
        () => initialPath || readFilesystemPickerLastPath(),
    );
    const [currentPath, setCurrentPath] = useState(openingPath);
    const [displayPath, setDisplayPath] = useState('');
    const [directories, setDirectories] = useState<string[]>([]);
    const [files, setFiles] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [queryState, setQueryState] = useState<QueryState>({
        initialQuery,
        value: initialQuery,
    });
    const searchQuery = queryState.initialQuery === initialQuery
        ? queryState.value
        : initialQuery;
    const [searchResults, setSearchResults] = useState<FilesystemSearchEntry[] | null>(null);
    const [searchTruncated, setSearchTruncated] = useState(false);
    const [roots, setRoots] = useState<FilesystemPickerController['roots']>(null);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const [checkedPaths, setCheckedPaths] = useState<string[]>([]);
    const [nativeAvailable, setNativeAvailable] = useState(false);
    const [nativePicking, setNativePicking] = useState(false);
    const [nativeError, setNativeError] = useState('');
    const [autoNativeDone, setAutoNativeDone] = useState(false);
    const modalRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Array<HTMLDivElement | null>>([]);

    const showFiles = mode === 'file' || mode === 'any';
    const canPickFolder = mode === 'folder' || mode === 'any';
    const canMulti = showFiles && onSelectMany !== null;
    const titleText = mode === 'any'
        ? tn('title_any')
        : mode === 'file' ? tn('title_file') : tn('title_folder');
    const searchPlaceholder = mode === 'folder'
        ? tn('search_folders_placeholder')
        : tn('search_placeholder');

    const browse = useCallback(async (path: string): Promise<boolean> => {
        setLoading(true);
        setError('');
        try {
            const data = await browseFilesystem(path);
            setRoots(data.roots);
            if (data.error) {
                setError(localizeError(data));
                if (data.display_path) setDisplayPath(data.display_path);
                if (data.current_path) setCurrentPath(data.current_path);
                return false;
            }
            const nextPath = data.current_path ?? '';
            const nextDirectories = data.directories ?? [];
            const nextFiles = data.files ?? [];
            setCurrentPath(nextPath);
            setDisplayPath(data.display_path ?? nextPath);
            setDirectories(nextDirectories);
            setFiles(nextFiles);
            setHighlightedIndex(
                nextDirectories.length + (showFiles ? nextFiles.length : 0) > 0
                    ? 0
                    : -1,
            );
            saveFilesystemPickerLastPath(nextPath);
            return true;
        } catch {
            setError(tn('connection_error'));
            return false;
        } finally {
            setLoading(false);
        }
    }, [localizeError, showFiles, tn]);

    useEffect(() => {
        const startPath = initialPath || openingPath || '';
        void Promise.resolve().then(async () => {
            const ok = await browse(startPath);
            if (!ok && !initialPath && startPath) await browse('');
        });
    }, [browse, initialPath, openingPath]);

    useEffect(() => {
        let cancelled = false;
        void fetchNativePickAvailability()
            .then((data) => {
                if (!cancelled) setNativeAvailable(data.available);
            })
            .catch(() => {
                if (!cancelled) setNativeAvailable(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const runSearch = useCallback(async (query: string): Promise<void> => {
        setLoading(true);
        try {
            const data = await searchFilesystem({ limit: 200, query });
            if (data.error) setError(localizeError(data));
            setSearchResults(data.results);
            setSearchTruncated(data.truncated);
            const resultCount = data.results.filter(
                (entry) => showFiles || entry.is_dir,
            ).length;
            setHighlightedIndex(resultCount > 0 ? 0 : -1);
        } catch {
            setError(tn('connection_error'));
            setSearchResults([]);
            setHighlightedIndex(-1);
        } finally {
            setLoading(false);
        }
    }, [localizeError, showFiles, tn]);

    useEffect(() => {
        const query = searchQuery.trim();
        if (query.length < 2) return undefined;
        const handle = window.setTimeout(() => {
            void runSearch(query);
        }, 300);
        return () => {
            window.clearTimeout(handle);
        };
    }, [runSearch, searchQuery]);

    useEffect(() => {
        if (highlightedIndex < 0) return;
        scrollPickerItemIntoView(itemRefs.current[highlightedIndex]);
    }, [highlightedIndex]);

    const handleSearchQueryChange = useCallback((value: string): void => {
        setQueryState({ initialQuery, value });
        if (value.trim().length >= 2) return;
        setSearchResults(null);
        setSearchTruncated(false);
        const browseCount = directories.length + (showFiles ? files.length : 0);
        setHighlightedIndex(browseCount > 0 ? 0 : -1);
    }, [directories.length, files.length, initialQuery, showFiles]);

    const toggleChecked = useCallback((path: string): void => {
        setCheckedPaths((previous) => previous.includes(path)
            ? previous.filter((entry) => entry !== path)
            : [...previous, path]);
    }, []);

    const handleSelectFileNow = useCallback((path: string): void => {
        saveFilesystemPickerLastPath(path.slice(0, path.lastIndexOf('/')));
        onSelect(path, { isDir: false });
    }, [onSelect]);

    const handleSelectFile = useCallback((filename: string): void => {
        const hostPath = joinFilesystemPath(displayPath || currentPath, filename);
        if (canMulti) {
            toggleChecked(hostPath);
            return;
        }
        onSelect(hostPath, { isDir: false });
    }, [canMulti, currentPath, displayPath, onSelect, toggleChecked]);

    const handleSearchResultClick = useCallback((item: FilesystemSearchEntry): void => {
        if (item.is_dir) {
            handleSearchQueryChange('');
            void browse(item.path);
        } else if (canMulti) {
            toggleChecked(item.path);
        } else if (showFiles) {
            handleSelectFileNow(item.path);
        }
    }, [browse, canMulti, handleSearchQueryChange, handleSelectFileNow, showFiles, toggleChecked]);

    const items = useMemo(() => buildFilesystemPickerItems({
        directories,
        files,
        searchResults,
        showFiles,
    }), [directories, files, searchResults, showFiles]);
    const parentPath = displayPath || currentPath;
    const itemFilePath = useCallback((item: (typeof items)[number] | undefined): string | null => (
        filesystemPickerItemFilePath(item, parentPath)
    ), [parentPath]);

    const openPath = useCallback((path: string): void => {
        void browse(path);
    }, [browse]);
    const openItem = useCallback((index: number): void => {
        const item = items[index];
        if (!item) return;
        if (item.kind === 'search') handleSearchResultClick(item.data);
        else if (item.kind === 'dir') openPath(joinFilesystemPath(currentPath, item.name));
        else handleSelectFile(item.name);
    }, [currentPath, handleSearchResultClick, handleSelectFile, items, openPath]);
    const openItemNow = useCallback((index: number): void => {
        const filePath = itemFilePath(items[index]);
        if (filePath) handleSelectFileNow(filePath);
    }, [handleSelectFileNow, itemFilePath, items]);
    const moveHighlight = useCallback((delta: number): void => {
        if (items.length === 0) return;
        setHighlightedIndex((index) => {
            const base = index < 0 ? (delta > 0 ? -1 : 0) : index;
            return Math.max(0, Math.min(items.length - 1, base + delta));
        });
    }, [items.length]);
    const goUp = useCallback((): void => {
        openPath(joinFilesystemPath(currentPath, '..'));
    }, [currentPath, openPath]);

    const handleListKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                moveHighlight(1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                moveHighlight(-1);
                break;
            case 'Home':
                event.preventDefault();
                setHighlightedIndex(items.length > 0 ? 0 : -1);
                break;
            case 'End':
                event.preventDefault();
                setHighlightedIndex(items.length - 1);
                break;
            case 'Enter':
                if (highlightedIndex >= 0) {
                    event.preventDefault();
                    openItem(highlightedIndex);
                }
                break;
            case ' ': {
                const filePath = itemFilePath(items[highlightedIndex]);
                if (canMulti && filePath) {
                    event.preventDefault();
                    toggleChecked(filePath);
                }
                break;
            }
            case 'ArrowRight': {
                const item = items[highlightedIndex];
                if (item && (item.kind === 'dir' || (item.kind === 'search' && item.data.is_dir))) {
                    event.preventDefault();
                    openItem(highlightedIndex);
                }
                break;
            }
            case 'ArrowLeft':
            case 'Backspace':
                event.preventDefault();
                goUp();
                break;
            default:
                break;
        }
    }, [canMulti, goUp, highlightedIndex, itemFilePath, items, moveHighlight, openItem, toggleChecked]);

    const handleSearchKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (items.length > 0) {
                setHighlightedIndex((index) => index < 0 ? 0 : index);
                listRef.current?.focus();
            }
        } else if (event.key === 'Enter' && items.length > 0) {
            event.preventDefault();
            openItem(highlightedIndex >= 0 ? highlightedIndex : 0);
        } else if (event.key === 'Backspace' && searchQuery === '') {
            event.preventDefault();
            goUp();
        }
    }, [goUp, highlightedIndex, items.length, openItem, searchQuery]);

    const runNativePick = useCallback(async (): Promise<void> => {
        if (nativePicking) return;
        setNativeError('');
        setNativePicking(true);
        try {
            const data = await pickNativeFilesystemEntry({
                mode,
                multiple: canMulti,
                prompt: titleText,
            });
            if (data.status !== 'ok' || !data.path) return;
            saveFilesystemPickerLastPath(
                data.is_dir ? data.path : data.path.slice(0, data.path.lastIndexOf('/')),
            );
            const picked = data.entries?.length
                ? data.entries.map((entry) => ({
                    isDir: entry.is_dir,
                    path: entry.path,
                }))
                : [{ isDir: data.is_dir ?? false, path: data.path }];
            if (canMulti && picked.length > 1) {
                onSelectMany(picked);
                return;
            }
            const first = picked.at(0);
            if (first) onSelect(first.path, { isDir: first.isDir });
        } catch {
            setNativeError(tn('native_error'));
        } finally {
            setNativePicking(false);
        }
    }, [canMulti, mode, nativePicking, onSelect, onSelectMany, titleText, tn]);
    const handleNativePick = useCallback((): void => {
        void runNativePick();
    }, [runNativePick]);

    useEffect(() => {
        if (!preferNative || !nativeAvailable || autoNativeDone || initialQuery) return;
        let cancelled = false;
        void Promise.resolve().then(() => {
            if (cancelled) return;
            setAutoNativeDone(true);
            handleNativePick();
        });
        return () => {
            cancelled = true;
        };
    }, [autoNativeDone, handleNativePick, initialQuery, nativeAvailable, preferNative]);

    const handleConfirmMany = useCallback((): void => {
        if (checkedPaths.length === 0 || !onSelectMany) return;
        onSelectMany(checkedPaths.map((path) => ({ isDir: false, path })));
    }, [checkedPaths, onSelectMany]);
    const handleSelectCurrentFolder = useCallback((): void => {
        onSelect(displayPath || currentPath, { isDir: true });
    }, [currentPath, displayPath, onSelect]);

    const controller: FilesystemPickerController = {
        canMulti,
        canPickFolder,
        checkedPaths,
        currentPath,
        displayPath,
        error,
        goUp,
        handleConfirmMany,
        handleListKeyDown,
        handleNativePick,
        handleSearchKeyDown,
        handleSearchQueryChange,
        handleSelectCurrentFolder,
        highlightedIndex,
        highlightItem: setHighlightedIndex,
        isChecked: (path) => checkedPaths.includes(path),
        isSearching: searchResults !== null,
        itemFilePath,
        items,
        loading,
        nativeAvailable,
        nativeError,
        nativePicking,
        openItem,
        openItemNow,
        openPath,
        roots,
        searchPlaceholder,
        searchQuery,
        searchTruncated,
        showFiles,
        titleText,
        tn,
    };
    return { controller, itemRefs, listRef, modalRef };
}
