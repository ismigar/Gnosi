export type InsertContentTab = 'local' | 'upload' | 'url' | 'vault';
export type InsertContentMode = 'block' | 'frame' | 'link';


export interface InsertImageMetadata {
    readonly alt?: string;
    readonly caption?: string;
    readonly credit?: string;
    readonly src?: string;
    readonly title?: string;
}


export interface InsertFileField {
    readonly fileMode?: string | null;
    readonly namePattern?: string | null;
    readonly propertyName?: string | null;
    readonly storageFolder?: string | null;
}


export interface LocalSelectionEntry {
    readonly isDir: boolean;
    readonly path: string;
}


interface SelectionBase {
    readonly kind: string;
    readonly name: string;
}


export interface VaultSelection extends SelectionBase {
    readonly source: 'vault';
    readonly url: string;
}


export interface UrlSelection extends SelectionBase {
    readonly source: 'url';
    readonly url: string;
}


export interface UploadSelection extends SelectionBase {
    readonly source: 'upload-pending';
}


export interface LocalFileSelection extends SelectionBase {
    readonly path: string;
    readonly source: 'local';
}


export interface LocalFolderSelection extends SelectionBase {
    readonly kind: 'folder';
    readonly path: string;
    readonly source: 'local-folder';
}


export interface LocalMultiSelection extends SelectionBase {
    readonly entries: readonly LocalSelectionEntry[];
    readonly paths: readonly string[];
    readonly source: 'local-multi';
}


export type InsertSelection =
    | LocalFileSelection
    | LocalFolderSelection
    | LocalMultiSelection
    | UploadSelection
    | UrlSelection
    | VaultSelection;


export interface InsertedContentItem {
    readonly kind: string;
    readonly name: string;
    readonly url: string;
}


export interface InsertContentResult {
    readonly imageMeta?: InsertImageMetadata;
    readonly items?: readonly InsertedContentItem[];
    readonly kind?: string;
    readonly metadataOnly?: boolean;
    readonly mode?: InsertContentMode;
    readonly name?: string;
    readonly url?: string;
    readonly urls?: readonly string[];
}


export interface InsertContentModalProps {
    readonly fileField?: InsertFileField | null;
    readonly imageField?: boolean;
    readonly initialFile?: File | null;
    readonly initialImageMeta?: InsertImageMetadata | null;
    readonly initialTab?: InsertContentTab;
    readonly onClose: () => void;
    readonly onInsert?: (result: InsertContentResult) => void;
    readonly open: boolean;
    readonly rowMetadata?: Readonly<Record<string, unknown>>;
    readonly tableId?: string | null;
}


export interface VaultMediaSelection {
    readonly filename?: string | null;
    readonly kind?: string | null;
    readonly name?: string | null;
    readonly url?: string | null;
}


export interface InsertContentState {
    readonly busy: boolean;
    readonly imageMeta: InsertImageMetadata;
    readonly materializing: boolean;
    readonly mode: InsertContentMode;
    readonly pickerOpen: boolean;
    readonly selected: InsertSelection | null;
    readonly tab: InsertContentTab;
    readonly uploadFile: File | null;
    readonly uploadProgress: number;
    readonly urlInput: string;
}
