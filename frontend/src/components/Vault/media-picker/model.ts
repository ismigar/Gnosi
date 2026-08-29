import type { MediaItem } from '../../../shared/api/media-browser';
import type { MediaKindFilter } from './types';


export const DEFAULT_MEDIA_ROOT = 'images';


export function normalizeMediaUrl(url: string | null | undefined): string {
    if (!url) return '';
    const match = /^https?:\/\/[^/]+(\/api\/.*)$/i.exec(url);
    return match?.[1] ?? url;
}


export function filterMediaItems(
    items: readonly MediaItem[],
    search: string,
    kindFilter: MediaKindFilter,
): readonly MediaItem[] {
    const normalizedSearch = search.trim().toLowerCase();
    return items.filter((item) => {
        const matchesKind = !kindFilter
            || (typeof kindFilter === 'string'
                ? item.kind === kindFilter
                : kindFilter.includes(item.kind));
        const matchesSearch = !normalizedSearch
            || item.filename.toLowerCase().includes(normalizedSearch);
        return matchesKind && matchesSearch;
    });
}
