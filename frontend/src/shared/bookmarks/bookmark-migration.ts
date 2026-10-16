import { fetchVaultBookmarks, importVaultBookmarks, type BookmarkCollection } from '../api/bookmarks';
import type { RequestContext } from '../api/request-context';
import { defineStorageKey, jsonStorageCodec, readStorage, stringStorageCodec, writeStorage } from '../platform/browser-storage';
import { bookmarkScope, isBookmark, loadBookmarks, type BookmarkSortMode } from './bookmarks';

const sortKey = defineStorageKey('gnosi.sidebar.favoritesSort', stringStorageCodec);
const modes: readonly string[] = ['manual', 'alpha-asc', 'alpha-desc', 'recent', 'oldest'];

function legacyOrder(): { mode: BookmarkSortMode; manualOrder: string[] } {
  try {
    const value: unknown = JSON.parse(readStorage(sortKey) || '{}');
    if (!value || typeof value !== 'object') return { mode: 'manual', manualOrder: [] };
    const mode = 'mode' in value && typeof value.mode === 'string' && modes.includes(value.mode)
      ? value.mode as BookmarkSortMode : 'manual';
    const manualOrder = 'manualOrder' in value && Array.isArray(value.manualOrder)
      ? value.manualOrder.filter((id): id is string => typeof id === 'string') : [];
    return { mode, manualOrder };
  } catch { return { mode: 'manual', manualOrder: [] }; }
}

const cacheCodec = jsonStorageCodec((value: unknown): value is BookmarkCollection => {
  if (!value || typeof value !== 'object' || !('entries' in value) || !('sort_mode' in value)) return false;
  return Array.isArray(value.entries) && value.entries.every(isBookmark)
    && value.entries.every(entry => typeof entry.created_at === 'number' && Number.isFinite(entry.created_at))
    && typeof value.sort_mode === 'string' && modes.includes(value.sort_mode);
});

function cacheScope(context: RequestContext): string {
  return JSON.stringify([context.workspaceId, context.vaultId, context.userId, context.userEmail]);
}

function cacheKey(context: RequestContext) {
  return defineStorageKey(`gnosi.bookmarks.cache.v2.${cacheScope(context)}`, cacheCodec);
}

export function cacheBookmarkCollection(context: RequestContext, collection: BookmarkCollection): void {
  writeStorage(cacheKey(context), collection);
}

export function cachedBookmarkCollection(context: RequestContext): BookmarkCollection | undefined {
  return readStorage(cacheKey(context));
}

export async function loadSyncedBookmarks(context: RequestContext, signal: AbortSignal): Promise<BookmarkCollection> {
  let collection = await fetchVaultBookmarks(context, signal);
  const scope = bookmarkScope(context);
  const entries = loadBookmarks(scope);
  const order = legacyOrder();
  const fingerprint = JSON.stringify([entries, order]);
  const receipt = defineStorageKey(`gnosi.bookmarks.migrated.v1.${cacheScope(context)}`, stringStorageCodec);
  if (readStorage(receipt) !== fingerprint) {
    collection = await importVaultBookmarks({ entries, sort_mode: order.mode, page_order: order.manualOrder }, context, signal);
    signal.throwIfAborted();
    // Keep the original v1 entries intact. A failed import or local write can
    // always retry, and the server's per-item receipts prevent resurrection.
    writeStorage(receipt, fingerprint);
  }
  signal.throwIfAborted();
  cacheBookmarkCollection(context, collection);
  return collection;
}
