import { defineStorageKey, readStorage, stringStorageCodec, writeStorage } from '../../../shared/platform/browser-storage';
import type { FavoritesSort, SidebarSections } from './types';

export const emptySections = (): SidebarSections => ({ favorites: false, dashboards: false, data: false, wiki: false });
const sectionKey = (mobile: boolean) => defineStorageKey(`gnosi.sidebar.sections.${mobile ? 'mobile' : 'desktop'}`, stringStorageCodec);
const lockKey = defineStorageKey('gnosi.sidebar.wikiDragLocked', stringStorageCodec);
const sortKey = defineStorageKey('gnosi.sidebar.favoritesSort', stringStorageCodec);

function record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

export function readSections(mobile: boolean): SidebarSections {
    try {
        const value = record(JSON.parse(readStorage(sectionKey(mobile)) || '{}'));
        return { ...emptySections(), favorites: Boolean(value.favorites), dashboards: Boolean(value.dashboards), data: Boolean(value.data), wiki: Boolean(value.wiki) };
    } catch { return emptySections(); }
}
export const saveSections = (mobile: boolean, value: SidebarSections): boolean => writeStorage(sectionKey(mobile), JSON.stringify(value));
export const readWikiLock = (): boolean => (readStorage(lockKey) ?? 'true') === 'true';
export const saveWikiLock = (value: boolean): boolean => writeStorage(lockKey, String(value));

export function readFavoritesSort(): FavoritesSort {
    try {
        const value = record(JSON.parse(readStorage(sortKey) || '{}'));
        const mode = value.mode;
        return {
            mode: mode === 'alpha-asc' || mode === 'alpha-desc' || mode === 'recent' || mode === 'oldest' ? mode : 'manual',
            manualOrder: Array.isArray(value.manualOrder) ? value.manualOrder.filter((id): id is string => typeof id === 'string') : [],
        };
    } catch { return { mode: 'manual', manualOrder: [] }; }
}
export const saveFavoritesSort = (value: FavoritesSort): boolean => writeStorage(sortKey, JSON.stringify(value));
