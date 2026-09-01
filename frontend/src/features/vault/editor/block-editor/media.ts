import { withActiveVault } from '../../../../shared/resources/fileResource';

export type NativeMediaBlockType = 'image' | 'video' | 'audio' | 'file';
interface MediaFile { readonly type?: string; readonly name?: string; }

/** Preserve the historical coercion at the untrusted metadata boundary. */
function metadataText(value: unknown): string { return String(value); }

export function isRequestCancelled(error: unknown, signal?: AbortSignal | null): boolean {
    return Boolean(signal?.aborted) || (error !== null && typeof error === 'object' && Reflect.get(error, 'name') === 'AbortError');
}

/** Canonical attachment_path wins; only local PDF URLs qualify as a fallback. */
export function getPdfSourceUri(metadata: unknown): string | null {
    if (!metadata || typeof metadata !== 'object') return null;
    const attachment: unknown = Reflect.get(metadata, 'attachment_path');
    const path = metadataText(attachment || '').trim();
    if (path) {
        if (/^file:\/\//i.test(path)) return path;
        if (path.startsWith('/')) return `file://${encodeURI(path)}`;
    }
    const rawUrl: unknown = Reflect.get(metadata, 'URL');
    const url = metadataText(rawUrl || '').trim();
    return /^file:\/\//i.test(url) && /\.pdf$/i.test(url) ? url : null;
}

export function nativeBlockTypeFor(file?: MediaFile | null): NativeMediaBlockType {
    const type = (file?.type || '').toLowerCase();
    const name = (file?.name || '').toLowerCase();
    if (type.startsWith('image/') || /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff)$/.test(name)) return 'image';
    if (type.startsWith('video/') || /\.(mp4|webm|ogv|mov|m4v|mkv)$/.test(name)) return 'video';
    if (type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac|aac)$/.test(name)) return 'audio';
    return 'file';
}

export const isVisualMediaFile = (file: MediaFile): boolean => nativeBlockTypeFor(file) !== 'file';

export function normalizeVaultAssetUrl(value: string): string;
export function normalizeVaultAssetUrl(value: unknown): unknown;
export function normalizeVaultAssetUrl(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    if (value.startsWith('Assets/')) return withActiveVault(`/api/vault/assets/${value.substring(7)}`);
    if (value.startsWith('/api/vault/assets/')) return withActiveVault(value);
    const absolute = value.match(/^https?:\/\/[^/]+\/api\/vault\/assets\/(.+)$/i);
    return absolute?.[1] ? withActiveVault(`/api/vault/assets/${absolute[1]}`) : value;
}

const MEDIA_TYPES = new Set<string>(['image', 'video', 'audio', 'file']);

export function countMediaBlocks(blocks: unknown): number {
    if (!Array.isArray(blocks)) return 0;
    let count = 0;
    for (const block of blocks as unknown[]) {
        if (!block || typeof block !== 'object') continue;
        const type: unknown = Reflect.get(block, 'type');
        if (typeof type === 'string' && MEDIA_TYPES.has(type)) count += 1;
        const children: unknown = Reflect.get(block, 'children');
        if (Array.isArray(children) && children.length) count += countMediaBlocks(children);
    }
    return count;
}
