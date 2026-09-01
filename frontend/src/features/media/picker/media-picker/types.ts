import type {
    MediaItem,
    MediaRoot,
    MediaTreeNode,
} from '../../../../shared/api/media-browser';


export type MediaKindFilter = string | readonly string[] | null;


export interface MediaPickerProps {
    readonly kindFilter?: MediaKindFilter;
    readonly onCancel?: (() => unknown) | null;
    readonly onSelect: (item: MediaItem) => unknown;
}


export interface MediaPickerController {
    readonly activePath: string | null;
    readonly activeRoot: string;
    readonly filteredItems: readonly MediaItem[];
    readonly loading: boolean;
    readonly roots: readonly MediaRoot[];
    readonly search: string;
    readonly selectPath: (path: string) => void;
    readonly selectRoot: (root: string) => void;
    readonly setSearch: (search: string) => void;
    readonly tree: readonly MediaTreeNode[];
}
