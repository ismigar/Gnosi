import type { VaultPagePreview } from '../api/vaults';
import { subscribeAppEvent } from '../platform/app-events';


const CACHE_MAX = 100;
const CACHE_TTL_MS = 5 * 60 * 1_000;


interface PreviewCacheEntry {
  readonly data: VaultPagePreview;
  readonly timestamp: number;
}


const previewCache = new Map<string, PreviewCacheEntry>();


export function readWikilinkPreviewCache(
  pageId: string,
): VaultPagePreview | null {
  const entry = previewCache.get(pageId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    previewCache.delete(pageId);
    return null;
  }
  return entry.data;
}


export function writeWikilinkPreviewCache(
  pageId: string,
  data: VaultPagePreview,
): void {
  if (previewCache.size >= CACHE_MAX) {
    const firstKey = previewCache.keys().next().value;
    if (typeof firstKey === 'string') previewCache.delete(firstKey);
  }
  previewCache.set(pageId, { data, timestamp: Date.now() });
}


export function invalidatePreviewCache(pageId?: string): void {
  if (pageId) previewCache.delete(pageId);
  else previewCache.clear();
}


subscribeAppEvent('gnosi:invalidatePreview', ({ pageId }) => {
  invalidatePreviewCache(pageId);
});
