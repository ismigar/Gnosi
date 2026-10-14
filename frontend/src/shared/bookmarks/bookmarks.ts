import { currentRequestContext } from '../api/request-context';
import { defineStorageKey, jsonStorageCodec, readStorage, writeStorage } from '../platform/browser-storage';

export type BookmarkKind = 'page' | 'section' | 'search' | 'graph' | 'url';
export interface VaultBookmark {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly kind: BookmarkKind;
  readonly target: string;
}

export function isBookmark(value: unknown): value is VaultBookmark {
  if (value === null || typeof value !== 'object') return false;
  const entry = value as Partial<VaultBookmark>;
  return typeof entry.id === 'string' && typeof entry.label === 'string'
    && typeof entry.group === 'string' && typeof entry.target === 'string'
    && ['page', 'section', 'search', 'graph', 'url'].includes(entry.kind ?? '')
    && entry.label.length <= 200 && entry.group.length <= 100 && entry.target.length <= 2000
    && Boolean(entry.label.trim()) && Boolean(entry.target.trim())
    && (entry.kind !== 'url' || /^https?:\/\//iu.test(entry.target))
    && (entry.kind !== 'graph' || /^(?:\/@[^/]+)?\/graph(?:[/?#]|$)/u.test(entry.target));
}

function isBookmarks(value: unknown): value is VaultBookmark[] {
  return Array.isArray(value) && value.length <= 500 && value.every(isBookmark)
    && new Set(value.map((entry) => entry.id)).size === value.length;
}

export function bookmarkScope(): string {
  const { workspaceId, vaultId, userId } = currentRequestContext();
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
