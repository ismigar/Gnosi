import type {
    InsertContentMode,
    InsertContentState,
    InsertContentTab,
    InsertFileField,
    InsertImageMetadata,
    InsertSelection,
} from './insertContentTypes';


const BLOCK_KINDS = new Set(['image', 'video', 'audio', 'pdf', 'doc', 'file']);
const FRAME_KINDS = new Set(['pdf', 'youtube', 'vimeo', 'web', 'image', 'video', 'audio']);


type ImageMetadataKey = 'alt' | 'caption' | 'credit' | 'title';


export type InsertContentAction =
    | { readonly busy: boolean; readonly type: 'set-busy' }
    | { readonly file: File | null; readonly origin: string; readonly type: 'set-upload-file' }
    | { readonly key: ImageMetadataKey; readonly type: 'set-image-meta'; readonly value: string }
    | { readonly materializing: boolean; readonly type: 'set-materializing' }
    | { readonly mode: InsertContentMode; readonly type: 'set-mode' }
    | { readonly open: boolean; readonly type: 'set-picker-open' }
    | { readonly progress: number; readonly type: 'set-upload-progress' }
    | { readonly selected: InsertSelection | null; readonly type: 'set-selection' }
    | { readonly origin: string; readonly tab: InsertContentTab; readonly type: 'set-tab' }
    | { readonly type: 'set-url'; readonly value: string; readonly origin: string };


export interface InitialInsertContentState {
    readonly imageMeta: InsertImageMetadata;
    readonly initialFile: File | null;
    readonly initialTab: InsertContentTab;
    readonly origin: string;
}


function errorRecord(value: unknown): Readonly<Record<string, unknown>> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Readonly<Record<string, unknown>>
        : null;
}


function errorString(record: Readonly<Record<string, unknown>> | null, key: string): string {
    const value = record?.[key];
    return typeof value === 'string' ? value : '';
}


export function detectUrlKind(value: string | null | undefined, origin: string): string | null {
    if (!value) return null;
    const lower = value.toLowerCase().split('?')[0]?.split('#')[0] ?? '';
    if (lower.endsWith('.pdf')) return 'pdf';
    if (/\.(jpg|jpeg|png|gif|webp|avif|svg|bmp|tiff)$/i.test(lower)) return 'image';
    if (/\.(mp4|webm|ogv|mov|m4v|mkv)$/i.test(lower)) return 'video';
    if (/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(lower)) return 'audio';
    if (/\.(doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|txt|md|rtf)$/i.test(lower)) return 'doc';
    try {
        const parsed = new URL(value, origin);
        const host = parsed.hostname.replace(/^www\./, '');
        if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') return 'youtube';
        if (host === 'vimeo.com' || host === 'player.vimeo.com') return 'vimeo';
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return 'web';
    } catch {
        return 'file';
    }
    return 'file';
}


export function detectPathKind(path: string, origin: string): string {
    if (!path) return 'file';
    const name = path.split('/').pop() || path;
    return detectUrlKind(name, origin) || 'file';
}


export function filenameFromUrl(value: string, origin: string): string {
    try {
        const parsed = new URL(value, origin);
        const last = parsed.pathname.split('/').filter(Boolean).pop();
        return decodeURIComponent(last || parsed.hostname || value);
    } catch {
        return value;
    }
}


export function defaultModeFor(kind: string): InsertContentMode {
    if (kind === 'pdf' || kind === 'youtube' || kind === 'vimeo' || kind === 'web') {
        return 'frame';
    }
    if (kind === 'image' || kind === 'video' || kind === 'audio') return 'block';
    return 'link';
}


export function modeAvailableFor(kind: string | null | undefined, mode: InsertContentMode): boolean {
    if (!kind) return true;
    if (mode === 'block') return BLOCK_KINDS.has(kind);
    if (mode === 'frame') return FRAME_KINDS.has(kind);
    return true;
}


export function allowedTabsFor(fileField: InsertFileField | null): readonly InsertContentTab[] {
    if (!fileField) return ['vault', 'local', 'upload', 'url'];
    return fileField.fileMode === 'link' ? ['local'] : ['upload', 'local'];
}


export function initialTabFor(
    fileField: InsertFileField | null,
    initialTab: InsertContentTab,
): InsertContentTab {
    if (!fileField) return initialTab;
    return fileField.fileMode === 'link' ? 'local' : 'upload';
}


export function createInitialState({
    imageMeta,
    initialFile,
    initialTab,
    origin,
}: InitialInsertContentState): InsertContentState {
    const selected = initialFile ? uploadSelection(initialFile, origin) : null;
    return {
        busy: false,
        imageMeta,
        materializing: false,
        mode: 'link',
        pickerOpen: false,
        selected,
        tab: initialFile ? 'upload' : initialTab,
        uploadFile: initialFile,
        uploadProgress: 0,
        urlInput: '',
    };
}


function withSelection(
    state: InsertContentState,
    selected: InsertSelection | null,
): InsertContentState {
    const mode = selected && !modeAvailableFor(selected.kind, state.mode)
        ? defaultModeFor(selected.kind)
        : state.mode;
    return { ...state, mode, selected };
}


function uploadSelection(file: File, origin: string): InsertSelection {
    return {
        kind: detectUrlKind(file.name, origin) || 'file',
        name: file.name,
        source: 'upload-pending',
    };
}


export function insertContentReducer(
    state: InsertContentState,
    action: InsertContentAction,
): InsertContentState {
    if (action.type === 'set-busy') return { ...state, busy: action.busy };
    if (action.type === 'set-materializing') {
        return { ...state, materializing: action.materializing };
    }
    if (action.type === 'set-mode') return { ...state, mode: action.mode };
    if (action.type === 'set-picker-open') return { ...state, pickerOpen: action.open };
    if (action.type === 'set-upload-progress') {
        return { ...state, uploadProgress: action.progress };
    }
    if (action.type === 'set-image-meta') {
        return {
            ...state,
            imageMeta: { ...state.imageMeta, [action.key]: action.value },
        };
    }
    if (action.type === 'set-selection') return withSelection(state, action.selected);
    if (action.type === 'set-upload-file') {
        const next = {
            ...state,
            uploadFile: action.file,
        };
        return withSelection(
            next,
            action.file ? uploadSelection(action.file, action.origin) : null,
        );
    }
    if (action.type === 'set-url') {
        const trimmed = action.value.trim();
        const selected: InsertSelection | null = trimmed ? {
            kind: detectUrlKind(trimmed, action.origin) || 'web',
            name: filenameFromUrl(trimmed, action.origin),
            source: 'url',
            url: trimmed,
        } : null;
        return withSelection({ ...state, urlInput: action.value }, selected);
    }
    const selected = action.tab === 'upload' && state.uploadFile
        ? uploadSelection(state.uploadFile, action.origin)
        : null;
    return withSelection({ ...state, tab: action.tab }, selected);
}


export function canInsertContent(
    state: InsertContentState,
    imageField: boolean,
    currentSrc: string,
): boolean {
    if (!state.selected) return Boolean(imageField && currentSrc);
    if (state.selected.source === 'upload-pending' && !state.uploadFile) return false;
    if (state.selected.source === 'url' && !state.urlInput.trim()) return false;
    return modeAvailableFor(state.selected.kind, state.mode);
}


export function isFocusableFileSelection(selection: InsertSelection | null): boolean {
    return selection?.source === 'upload-pending'
        || selection?.source === 'local'
        || selection?.source === 'local-folder'
        || selection?.source === 'local-multi';
}


export function uploadErrorMessage(
    error: unknown,
    translate: (key: string, fallback: string) => string,
): string {
    const record = errorRecord(error);
    const message = error instanceof Error ? error.message : errorString(record, 'message');
    if (message === 'unreadable-file') {
        return translate(
            'insert.error_unreadable_file',
            'Couldn\'t read the file. If it\'s online-only (OneDrive or iCloud), make it available locally (Finder → "Keep on this device") and try again.',
        );
    }
    const code = errorString(record, 'code');
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout/i.test(message)) {
        return translate(
            'insert.error_upload_timeout',
            'The upload took too long. If the file is online-only (OneDrive or iCloud), make it available locally and try again.',
        );
    }
    const response = errorRecord(record?.response);
    const data = errorRecord(response?.data);
    return errorString(data, 'detail')
        || errorString(data, 'error')
        || message
        || translate('errors.unknown', 'Unknown error');
}
