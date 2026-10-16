import { currentRequestContext, type RequestContext } from '../api/request-context';
import { defineStorageKey, jsonStorageCodec, readStorage, writeStorage } from '../platform/browser-storage';
import { isBookmarkPageId, isBookmarkRoute, pageIdFromBookmarkRoute } from './bookmark-routes';

export type BookmarkKind = 'page' | 'section' | 'search' | 'graph' | 'url' | 'route';
export type BookmarkSortMode = 'manual' | 'alpha-asc' | 'alpha-desc' | 'recent' | 'oldest';
export interface VaultBookmark {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly kind: BookmarkKind;
  readonly target: string;
  readonly created_at?: number;
}

export function normalizeBookmarkDestination(entry: VaultBookmark): VaultBookmark {
  const pageId = entry.kind === 'route' ? pageIdFromBookmarkRoute(entry.target) : null;
  return pageId ? { ...entry, kind: 'page', target: pageId } : entry;
}

function isLegacyBookmark(value: unknown): value is VaultBookmark {
  if (value === null || typeof value !== 'object') return false;
  const entry = value as Partial<VaultBookmark>;
  return typeof entry.id === 'string' && typeof entry.label === 'string'
    && typeof entry.group === 'string' && typeof entry.target === 'string'
    && ['page', 'section', 'search', 'graph', 'url', 'route'].includes(entry.kind ?? '')
    && entry.label.length <= 200 && entry.group.length <= 100 && entry.target.length <= 2000
    && Boolean(entry.label.trim()) && Boolean(entry.target.trim())
    && (entry.kind !== 'url' || /^https?:\/\//iu.test(entry.target))
    && (entry.kind !== 'graph' || /^(?:\/@[^/]+)?\/graph(?:[/?#]|$)/u.test(entry.target));
}

export function isBookmark(value: unknown): value is VaultBookmark {
  if (!isLegacyBookmark(value) || !/^[A-Za-z0-9_-]{1,160}$/u.test(value.id)) return false;
  if (value.kind === 'route') return isBookmarkRoute(value.target);
  if (Array.from(value.target).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  if (value.kind === 'page') return isBookmarkPageId(value.target);
  if (value.kind === 'section') {
    const separator = value.target.indexOf('#');
    return separator > 0 && isBookmarkPageId(value.target.slice(0, separator))
      && !['[', ']', '|'].some(delimiter => value.target.slice(0, separator).includes(delimiter))
      && Boolean(value.target.slice(separator + 1).trim()) && !['[', ']', '|'].some(delimiter => value.target.slice(separator + 1).includes(delimiter));
  }
  if (value.kind === 'url') {
    try {
      const parsed = new URL(value.target);
      return ['http:', 'https:'].includes(parsed.protocol) && Boolean(parsed.hostname)
        && !parsed.username && !parsed.password && !value.target.includes('\\');
    } catch { return false; }
  }
  if (value.kind === 'graph') {
    try {
      const path = decodeURIComponent(value.target.split(/[?#]/u)[0] ?? '');
      return /^(?:\/@[a-z0-9-]+)?\/graph\/?$/u.test(path) && !value.target.includes('\\');
    } catch { return false; }
  }
  return true;
}

function isBookmarks(value: unknown): value is VaultBookmark[] {
  return Array.isArray(value) && value.length <= 500 && value.every(isLegacyBookmark)
    && new Set(value.map((entry) => entry.id)).size === value.length;
}

export function bookmarkScope(context: RequestContext = currentRequestContext()): string {
  const { workspaceId, vaultId, userId } = context;
  return JSON.stringify([workspaceId, vaultId, userId]);
}

function storageKey(scope: string) {
  return defineStorageKey(`gnosi.bookmarks.v1.${scope}`, jsonStorageCodec(isBookmarks));
}

export function loadBookmarks(scope: string): VaultBookmark[] {
  return readStorage(storageKey(scope)) ?? [];
}

export function saveBookmarks(scope: string, entries: VaultBookmark[]): boolean {
  return isBookmarks(entries) && writeStorage(storageKey(scope), entries);
}

export function moveBookmark(entries: readonly VaultBookmark[], id: string, direction: -1 | 1): VaultBookmark[] {
  const result = [...entries];
  const index = result.findIndex((entry) => entry.id === id);
  const entry = result[index];
  let destinationIndex = index + direction;
  while (destinationIndex >= 0 && destinationIndex < result.length && result[destinationIndex]?.group !== entry?.group) destinationIndex += direction;
  const destination = result[destinationIndex];
  if (!entry || !destination) return result;
  result[index] = destination;
  result[destinationIndex] = entry;
  return result;
}
