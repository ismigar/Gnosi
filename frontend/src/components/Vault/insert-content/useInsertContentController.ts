import { useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { interpolateNamePattern } from '../../../lib/fileResource';
import { toast } from '../../../lib/toast';
import {
    allowedTabsFor,
    canInsertContent,
    createInitialState,
    detectPathKind,
    detectUrlKind,
    initialTabFor,
    insertContentReducer,
    uploadErrorMessage,
} from './insertContentModel';
import {
    localFolderSentinel,
    performInsertUpload,
    registerInsertLocalFile,
    type InsertTransferContext,
} from './insertContentTransfers';
import type {
    InsertContentModalProps,
    InsertContentMode,
    InsertContentState,
    InsertContentTab,
    InsertImageMetadata,
    LocalSelectionEntry,
    VaultMediaSelection,
} from './insertContentTypes';


interface DestinationRequest {
    readonly resolve: (path: string | null) => void;
}


export interface InsertContentActions {
    readonly cancelDestination: () => void;
    readonly closePicker: () => void;
    readonly confirm: () => Promise<void>;
    readonly dropUploadFiles: (files: FileList | null) => void;
    readonly openPicker: () => void;
    readonly pickUploadFiles: (files: FileList | null) => Promise<void>;
    readonly selectDestination: (path: string) => void;
    readonly selectLocal: (path: string, metadata?: { readonly isDir?: boolean }) => void;
    readonly selectLocalMany: (entries: readonly LocalSelectionEntry[]) => void;
    readonly selectMode: (mode: InsertContentMode) => void;
    readonly selectTab: (tab: InsertContentTab) => void;
    readonly selectVault: (item: VaultMediaSelection) => void;
    readonly setImageMetadata: (
        key: 'alt' | 'caption' | 'credit' | 'title',
        value: string,
    ) => void;
    readonly setUrl: (value: string) => void;
}


export interface InsertContentController {
    readonly actions: InsertContentActions;
    readonly allowedTabs: readonly InsertContentTab[];
    readonly canInsert: boolean;
    readonly currentSrc: string;
    readonly destinationPickerOpen: boolean;
    readonly fileField: InsertContentModalProps['fileField'];
    readonly imageField: boolean;
    readonly isFieldUpload: boolean;
    readonly isFreeStorage: boolean;
    readonly resolvedName: string;
    readonly state: InsertContentState;
    readonly tab: InsertContentTab;
}


function browserOrigin(): string {
    return globalThis.location.origin;
}


export function useInsertContentController({
    fileField = null,
    imageField = false,
    initialFile = null,
    initialImageMeta = null,
    initialTab = 'vault',
    onClose,
    onInsert,
    rowMetadata = {},
    tableId = null,
}: InsertContentModalProps): InsertContentController {
    const { t } = useTranslation();
    const origin = browserOrigin();
    const initialState = {
        imageMeta: initialImageMeta || {},
        initialFile,
        initialTab: initialTabFor(fileField, initialTab),
        origin,
    };
    const [state, dispatch] = useReducer(
        insertContentReducer,
        initialState,
        createInitialState,
    );
    const [destinationRequest, setDestinationRequest] = useState<DestinationRequest | null>(null);
    const allowedTabs = allowedTabsFor(fileField);
    const tab = allowedTabs.includes(state.tab) ? state.tab : allowedTabs[0] || 'vault';
    const currentSrc = imageField ? initialImageMeta?.src || '' : '';
    const isFieldUpload = Boolean(fileField?.propertyName && tableId);
    const resolvedName = fileField?.namePattern
        ? interpolateNamePattern(fileField.namePattern, rowMetadata)
        : '';
    const isFreeStorage = isFieldUpload && fileField?.storageFolder === 'free';
    const transferContext: InsertTransferContext = {
        fileField,
        isFieldUpload,
        resolvedName,
        tableId,
    };

    const requestDestination = (): Promise<string | null> => new Promise((resolve) => {
        setDestinationRequest({ resolve });
    });
    const closeDestination = (path: string | null): void => {
        destinationRequest?.resolve(path);
        setDestinationRequest(null);
    };
    const translateFallback = (key: string, fallback: string): string => t(key, {
        defaultValue: fallback,
    });
    const insertError = (error: unknown): void => {
        const message = uploadErrorMessage(error, translateFallback);
        toast.error(t('insert.error', {
            defaultValue: 'Error inserting: {{msg}}',
            msg: message,
        }));
    };
    const performUpload = async (file: File, destinationFolder = ''): Promise<string> => (
        performInsertUpload(file, destinationFolder, transferContext, {
            onMaterializing: (materializing) => {
                dispatch({ materializing, type: 'set-materializing' });
            },
            onProgress: (progress) => {
                dispatch({ progress, type: 'set-upload-progress' });
            },
        })
    );
    const registerLocalFile = (path: string): Promise<string> => (
        registerInsertLocalFile(path, transferContext)
    );
    const selectTab = (nextTab: InsertContentTab): void => {
        dispatch({ origin, tab: nextTab, type: 'set-tab' });
    };
    const selectVault = (item: VaultMediaSelection): void => {
        if (!item.url) return;
        dispatch({
            selected: {
                kind: item.kind || detectUrlKind(item.url, origin) || 'file',
                name: item.filename || item.name || item.url,
                source: 'vault',
                url: item.url,
            },
            type: 'set-selection',
        });
    };
    const selectLocal = (
        path: string,
        { isDir = false }: { readonly isDir?: boolean } = {},
    ): void => {
        if (!path) return;
        const name = path.split('/').pop() || path;
        dispatch({
            selected: isDir ? {
                kind: 'folder',
                name,
                path,
                source: 'local-folder',
            } : {
                kind: detectPathKind(path, origin),
                name,
                path,
                source: 'local',
            },
            type: 'set-selection',
        });
        dispatch({ open: false, type: 'set-picker-open' });
    };
    const selectLocalMany = (entries: readonly LocalSelectionEntry[]): void => {
        const list = entries.filter((entry) => Boolean(entry.path));
        if (list.length === 0) return;
        const first = list.at(0);
        if (list.length === 1 && first) {
            selectLocal(first.path, { isDir: first.isDir });
            return;
        }
        dispatch({
            selected: {
                entries: list,
                kind: 'file',
                name: list.map((entry) => entry.path.split('/').pop() || entry.path).join(', '),
                paths: list.map((entry) => entry.path),
                source: 'local-multi',
            },
            type: 'set-selection',
        });
        dispatch({ mode: 'link', type: 'set-mode' });
        dispatch({ open: false, type: 'set-picker-open' });
    };
    const pickUploadFile = (file: File | null): void => {
        if (!file) return;
        dispatch({ file, origin, type: 'set-upload-file' });
    };
    const pickUploadFiles = async (fileList: FileList | null): Promise<void> => {
        const files = Array.from(fileList || []).filter(Boolean);
        if (files.length === 0) return;
        if (!(isFieldUpload && files.length > 1)) {
            pickUploadFile(files.at(0) || null);
            return;
        }
        let destinationFolder = '';
        if (isFreeStorage) {
            destinationFolder = await requestDestination() || '';
            if (!destinationFolder) return;
        }
        dispatch({ busy: true, type: 'set-busy' });
        try {
            const urls: string[] = [];
            for (const file of files) {
                const url = await performUpload(file, destinationFolder);
                if (url) urls.push(url);
            }
            if (!urls.length) {
                throw new Error(t('insert.error_no_upload', {
                    defaultValue: 'No file could be uploaded',
                }));
            }
            onInsert?.({ kind: 'file', urls });
            onClose();
        } catch (error) {
            insertError(error);
        } finally {
            dispatch({ busy: false, type: 'set-busy' });
        }
    };

    const confirm = async (): Promise<void> => {
        if (!state.selected && imageField && currentSrc) {
            onInsert?.({ imageMeta: state.imageMeta, metadataOnly: true });
            onClose();
            return;
        }
        if (!state.selected) return;
        let destinationFolder = '';
        if (isFreeStorage && state.selected.source === 'upload-pending' && state.uploadFile) {
            destinationFolder = await requestDestination() || '';
            if (!destinationFolder) return;
        }
        dispatch({ busy: true, type: 'set-busy' });
        try {
            if (state.selected.source === 'local-multi') {
                const items = [];
                for (const entry of state.selected.entries) {
                    const url = entry.isDir
                        ? localFolderSentinel(entry.path)
                        : await registerLocalFile(entry.path);
                    if (url) {
                        items.push({
                            kind: entry.isDir ? 'folder' : detectPathKind(entry.path, origin),
                            name: entry.path.split('/').pop() || entry.path,
                            url,
                        });
                    }
                }
                if (!items.length) {
                    throw new Error(t('insert.error_no_url', {
                        defaultValue: 'Could not obtain the final URL',
                    }));
                }
                onInsert?.({
                    items,
                    kind: 'file',
                    mode: 'link',
                    urls: items.map((item) => item.url),
                });
                onClose();
                return;
            }
            let finalUrl = 'url' in state.selected ? state.selected.url : '';
            if (state.selected.source === 'upload-pending' && state.uploadFile) {
                finalUrl = await performUpload(state.uploadFile, destinationFolder);
            } else if (state.selected.source === 'local') {
                finalUrl = await registerLocalFile(state.selected.path);
            } else if (state.selected.source === 'local-folder') {
                finalUrl = localFolderSentinel(state.selected.path);
            }
            if (!finalUrl) {
                throw new Error(t('insert.error_no_url', {
                    defaultValue: 'Could not obtain the final URL',
                }));
            }
            onInsert?.({
                imageMeta: imageField ? state.imageMeta : undefined,
                kind: state.selected.kind,
                mode: state.mode,
                name: state.selected.name,
                url: finalUrl,
            });
            onClose();
        } catch (error) {
            if (error instanceof Error && error.message === 'unreadable-file') {
                selectTab('local');
                toast.error(t('insert.error_unreadable_switch_local', {
                    defaultValue: 'This file is online-only. Locate it in "Local disk" and Gnosi will download it automatically.',
                }));
            } else {
                insertError(error);
            }
        } finally {
            dispatch({ busy: false, type: 'set-busy' });
        }
    };

    return {
        actions: {
            cancelDestination: () => {
                closeDestination(null);
            },
            closePicker: () => {
                dispatch({ open: false, type: 'set-picker-open' });
            },
            confirm,
            dropUploadFiles: (files) => {
                void pickUploadFiles(files);
            },
            openPicker: () => {
                dispatch({ open: true, type: 'set-picker-open' });
            },
            pickUploadFiles,
            selectDestination: (path) => {
                closeDestination(path);
            },
            selectLocal,
            selectLocalMany,
            selectMode: (mode) => {
                dispatch({ mode, type: 'set-mode' });
            },
            selectTab,
            selectVault,
            setImageMetadata: (key, value) => {
                dispatch({ key, type: 'set-image-meta', value });
            },
            setUrl: (value) => {
                dispatch({ origin, type: 'set-url', value });
            },
        },
        allowedTabs,
        canInsert: canInsertContent(state, imageField, currentSrc),
        currentSrc,
        destinationPickerOpen: destinationRequest !== null,
        fileField,
        imageField,
        isFieldUpload,
        isFreeStorage,
        resolvedName,
        state,
        tab,
    };
}
