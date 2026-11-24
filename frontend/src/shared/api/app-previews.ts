import { defineStorageKey, jsonStorageCodec, readStorage, writeStorage } from '../platform/browser-storage';
import { currentRequestContext, type RequestContext } from './request-context';

export const APP_PREVIEW_LIMIT = 5;
export type PreviewSource = 'mail' | 'media' | 'planning' | 'social' | 'websites';

export interface AppPreviewItem {
    readonly id: string;
    readonly title: string;
    readonly detail?: string;
    readonly date?: string;
    readonly count?: number;
}

export interface AppPreview {
    readonly observedAt: number;
    readonly sourceId?: string;
    readonly items: readonly AppPreviewItem[];
}

function validItem(item: unknown): item is AppPreviewItem {
    if (typeof item !== 'object' || item === null) return false;
    return 'id' in item && typeof item.id === 'string' && item.id.length <= 2000
        && 'title' in item && typeof item.title === 'string' && item.title.length <= 240
        && (!('detail' in item) || typeof item.detail === 'string' && item.detail.length <= 160)
        && (!('date' in item) || typeof item.date === 'string' && item.date.length <= 64)
        && (!('count' in item) || typeof item.count === 'number' && Number.isSafeInteger(item.count) && item.count >= 0);
}

const previewCodec = jsonStorageCodec((value: unknown): value is AppPreview => {
    if (typeof value !== 'object' || value === null) return false;
    return 'observedAt' in value && typeof value.observedAt === 'number' && Number.isFinite(value.observedAt)
        && (!('sourceId' in value) || typeof value.sourceId === 'string')
        && 'items' in value && Array.isArray(value.items)
        && value.items.length <= APP_PREVIEW_LIMIT && value.items.every(validItem);
});

function key(source: PreviewSource, scope: RequestContext) {
    const identity = JSON.stringify([scope.vaultId, scope.workspaceId, scope.userId, scope.userEmail]);
    return defineStorageKey(`gnosi.app-preview.v1.${source}.${identity}`, previewCodec);
}

/** Read a small device-local summary without opening or refreshing the source application. */
export function readAppPreview(source: PreviewSource, scope: RequestContext): AppPreview | undefined {
    return scope.vaultId ? readStorage(key(source, scope)) : undefined;
}

/** Called by the source app after a successful read. Keep titles and counts, never document bodies or credentials. */
export function rememberAppPreview(source: PreviewSource, scope: RequestContext, items: readonly AppPreviewItem[], sourceId?: string, observedAt = Date.now()): void {
    const target = key(source, scope);
    if (!scope.vaultId || target.name !== key(source, currentRequestContext()).name) return;
    const preview = items.slice(0, APP_PREVIEW_LIMIT).map(({ id, title, detail, date, count }) => ({
        id, title: title.slice(0, 240), detail: detail?.slice(0, 160), date, count,
    }));
    writeStorage(target, { observedAt, items: preview, sourceId });
}
