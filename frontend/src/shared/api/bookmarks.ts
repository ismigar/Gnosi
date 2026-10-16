import type { components } from '../../generated/openapi';
import { pageIdFromBookmarkRoute } from '../bookmarks/bookmark-routes';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';
import { currentRequestContext, type RequestContext } from './request-context';

export type BookmarkCollection = components['schemas']['BookmarkCollection'];
export type BookmarkEntry = components['schemas']['BookmarkEntry'];
export type BookmarkImport = components['schemas']['BookmarkImport'];
export type BookmarkSortMode = BookmarkCollection['sort_mode'];

function headers(context: RequestContext) {
  return { 'X-Vault-ID': context.vaultId, 'X-Workspace-ID': context.workspaceId,
    'X-User-ID': context.userId, 'X-User-Email': context.userEmail };
}

export function assertBookmarkContext(context: RequestContext): void {
  const current = currentRequestContext();
  if (current.vaultId !== context.vaultId || current.workspaceId !== context.workspaceId
    || current.userId !== context.userId || current.userEmail !== context.userEmail) {
    throw new DOMException('Bookmark context changed before mutation', 'AbortError');
  }
}

/** Strip read-only timestamps from items before submitting the public input. */
export function bookmarkInput(entry: BookmarkEntry): BookmarkEntry {
  const { id, label, group, kind, target } = entry;
  const pageId = kind === 'route' ? pageIdFromBookmarkRoute(target) : null;
  return { id, label, group, kind: pageId ? 'page' : kind, target: pageId ?? target };
}

export async function fetchVaultBookmarks(context: RequestContext, signal?: AbortSignal): Promise<BookmarkCollection> {
  return unwrapApiResult(await apiClient.GET('/api/vault/bookmarks', { headers: headers(context), signal }));
}

export async function importVaultBookmarks(input: BookmarkImport, context: RequestContext, signal?: AbortSignal): Promise<BookmarkCollection> {
  assertBookmarkContext(context);
  return unwrapApiResult(await apiClient.POST('/api/vault/bookmarks/import', {
    body: { ...input, entries: input.entries.map(bookmarkInput) }, headers: headers(context), signal,
  }));
}

export async function saveVaultBookmark(entry: BookmarkEntry, context: RequestContext): Promise<BookmarkCollection> {
  assertBookmarkContext(context);
  return unwrapApiResult(await apiClient.PUT('/api/vault/bookmarks/items/{bookmark_id}', {
    params: { path: { bookmark_id: entry.id } }, body: bookmarkInput(entry), headers: headers(context),
  }));
}

export async function deleteVaultBookmark(id: string, context: RequestContext): Promise<BookmarkCollection> {
  assertBookmarkContext(context);
  return unwrapApiResult(await apiClient.DELETE('/api/vault/bookmarks/items/{bookmark_id}', {
    params: { path: { bookmark_id: id } }, headers: headers(context),
  }));
}

export async function reorderVaultBookmarks(ids: readonly string[], context: RequestContext): Promise<BookmarkCollection> {
  assertBookmarkContext(context);
  return unwrapApiResult(await apiClient.POST('/api/vault/bookmarks/reorder', {
    body: { ids: [...ids] }, headers: headers(context),
  }));
}

export async function sortVaultBookmarks(mode: BookmarkSortMode, context: RequestContext): Promise<BookmarkCollection> {
  assertBookmarkContext(context);
  return unwrapApiResult(await apiClient.PUT('/api/vault/bookmarks/sort', {
    body: { mode }, headers: headers(context),
  }));
}

export async function setVaultPageBookmark(pageId: string, label: string, enabled: boolean, context: RequestContext): Promise<BookmarkCollection> {
  assertBookmarkContext(context);
  return unwrapApiResult(await apiClient.PUT('/api/vault/bookmarks/pages/{page_id}', {
    params: { path: { page_id: pageId } }, body: { label, enabled }, headers: headers(context),
  }));
}

export async function setVaultRouteBookmark(target: string, label: string, enabled: boolean, context: RequestContext): Promise<BookmarkCollection> {
  assertBookmarkContext(context);
  return unwrapApiResult(await apiClient.PUT('/api/vault/bookmarks/route', {
    body: { target, label, enabled }, headers: headers(context),
  }));
}
