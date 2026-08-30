import type { VaultPagePreview } from '../../api/vaults';
import { subscribeAppEvent } from '../../platform/app-events';


export type HoverMetadata = Readonly<Record<string, unknown>>;
export type VisibleHoverProperty = readonly [key: string, value: string];


export interface NormalizedHoverPreview {
    readonly body: string;
    readonly cover: string;
    readonly icon: string;
    readonly title: string;
}


interface PreviewCacheEntry {
    readonly data: VaultPagePreview;
    readonly timestamp: number;
}


const CACHE_MAX = 40;
const CACHE_TTL_MS = 5 * 60 * 1000;
const fullPreviewCache = new Map<string, PreviewCacheEntry>();
const hiddenMetadataKeys = new Set([
    'cover',
    'database_table_id',
    'icon',
    'id',
    'table_id',
    'title',
]);
const webUrlKeys = ['drupal_url', 'Drupal URL', 'url', 'URL', 'enllaç', 'link'];


function hoverPreviewString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}


export function normalizeHoverPreview(
    preview: VaultPagePreview | null,
): NormalizedHoverPreview {
    return {
        body: hoverPreviewString(preview?.body_md),
        cover: hoverPreviewString(preview?.cover),
        icon: hoverPreviewString(preview?.icon),
        title: hoverPreviewString(preview?.title),
    };
}


export function readHoverPreviewCache(pageId: string): VaultPagePreview | null {
    const entry = fullPreviewCache.get(pageId);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        fullPreviewCache.delete(pageId);
        return null;
    }
    return entry.data;
}


export function writeHoverPreviewCache(
    pageId: string,
    data: VaultPagePreview,
): void {
    if (fullPreviewCache.size >= CACHE_MAX) {
        const firstKey = fullPreviewCache.keys().next().value;
        if (typeof firstKey === 'string') fullPreviewCache.delete(firstKey);
    }
    fullPreviewCache.set(pageId, { data, timestamp: Date.now() });
}


export function invalidateHoverPreviewCache(pageId?: string): void {
    if (pageId) fullPreviewCache.delete(pageId);
    else fullPreviewCache.clear();
}


subscribeAppEvent('gnosi:invalidatePreview', ({ pageId }) => {
    invalidateHoverPreviewCache(pageId);
});


export function pickHoverWebUrl(metadata: HoverMetadata | null): string | null {
    if (!metadata) return null;
    for (const key of webUrlKeys) {
        const value = metadata[key];
        if (typeof value === 'string' && /^https?:\/\//iu.test(value)) return value;
    }
    return null;
}


export function formatHoverMetadataValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) {
        return value.map(formatHoverMetadataValue).filter(Boolean).join(', ');
    }
    if (typeof value === 'object') {
        const record = value as Readonly<Record<string, unknown>>;
        const candidate = record.src ?? record.title ?? record.alt;
        return typeof candidate === 'string' ? candidate : '';
    }
    if (
        typeof value !== 'string'
        && typeof value !== 'number'
        && typeof value !== 'bigint'
        && typeof value !== 'boolean'
    ) return '';
    return String(value)
        .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu, '$1')
        .trim();
}


function looksLikeRelationValue(value: unknown): boolean {
    const values: readonly unknown[] = Array.isArray(value) ? value : [value];
    return values.length > 0 && values.every((item) => (
        typeof item === 'string'
        && (
            /^\s*\[\[.+\|.+\]\]\s*$/u.test(item)
            || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(item.trim())
        )
    ));
}


export function visibleHoverProperties(
    metadata: HoverMetadata | null,
): VisibleHoverProperty[] {
    if (!metadata) return [];
    return Object.entries(metadata)
        .filter(([key, value]) => (
            !hiddenMetadataKeys.has(key)
            && !key.startsWith('drupal_')
            && !looksLikeRelationValue(value)
            && !key.endsWith('_manual')
            && key !== 'Drupal URL'
            && key !== 'Drupal NID'
        ))
        .map(([key, value]) => [key, formatHoverMetadataValue(value)] as const)
        .filter(([, value]) => value.length > 0)
        .slice(0, 10);
}
