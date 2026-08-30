import { defineStorageKey, jsonStorageCodec, readStorage, writeStorage } from '../../../../shared/platform/browser-storage';

const stringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every(item => typeof item === 'string');
const key = (pageId: string, viewId: string) => defineStorageKey(
    `gnosi_embed_pinned_${pageId}_${viewId || 'default'}`, jsonStorageCodec(stringArray),
);

export function readPinnedViews(pageId: string, viewId: string): Set<string> {
    return new Set(readStorage(key(pageId, viewId)) || []);
}
export function writePinnedViews(pageId: string, viewId: string, pins: ReadonlySet<string>): void {
    writeStorage(key(pageId, viewId), [...pins]);
}
