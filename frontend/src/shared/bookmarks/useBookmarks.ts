import { useIsMutating, useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { assertBookmarkContext, deleteVaultBookmark, reorderVaultBookmarks, saveVaultBookmark,
  setVaultPageBookmark, setVaultRouteBookmark, sortVaultBookmarks, type BookmarkCollection } from '../api/bookmarks';
import { queryClient } from '../api/query-client';
import type { RequestContext } from '../api/request-context';
import { useRequestContext } from '../hooks/useRequestContext';
import { cacheBookmarkCollection, cachedBookmarkCollection, loadSyncedBookmarks } from './bookmark-migration';
import type { BookmarkSortMode, VaultBookmark } from './bookmarks';

// Serialize reads and writes per identity as well as React Query mutations.
// A slow pre-mutation refresh must never replace a successful newer response.
const queues = new Map<string, Promise<unknown>>();
const emptyEntries: VaultBookmark[] = [];
function serial<T>(scope: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(scope) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  queues.set(scope, next);
  void next.finally(() => { if (queues.get(scope) === next) queues.delete(scope); }).catch(() => undefined);
  return next;
}

export const bookmarkQueryKey = (context: RequestContext) => ['vault-bookmarks', context.workspaceId, context.vaultId, context.userId, context.userEmail] as const;

export function useBookmarks() {
  const context = useRequestContext();
  const key = bookmarkQueryKey(context);
  const scope = JSON.stringify(key);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => serial(scope, () => { signal.throwIfAborted(); return loadSyncedBookmarks(context, signal); }),
    enabled: Boolean(context.vaultId),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: 'always',
  }, queryClient);
  const mutationKey = ['vault-bookmarks-write', scope];
  const pending = useIsMutating({ mutationKey }, queryClient) > 0;
  const mutation = useMutation({
    mutationKey,
    scope: { id: scope },
    mutationFn: async (operation: () => Promise<BookmarkCollection>) => {
      assertBookmarkContext(context);
      if (!context.vaultId || queryClient.getQueryState(key)?.status !== 'success') {
        throw new Error('Bookmarks must finish synchronizing before editing');
      }
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      return serial(scope, () => { assertBookmarkContext(context); return operation(); });
    },
    onSuccess: collection => {
      cacheBookmarkCollection(context, collection);
      queryClient.setQueryData(key, collection);
    },
  }, queryClient);
  const cached = useMemo(() => cachedBookmarkCollection(context), [context]);
  const data = query.data ?? cached;
  const entries = data?.entries ?? emptyEntries;
  const pageIds = useMemo(() => new Set(entries.filter(entry => entry.kind === 'page').map(entry => entry.target)), [entries]);
  const routeTargets = useMemo(() => new Set(entries.filter(entry => entry.kind === 'route').map(entry => entry.target)), [entries]);
  return {
    entries, pageIds, routeTargets,
    sortMode: data?.sort_mode ?? 'manual',
    isReady: query.isSuccess && Boolean(context.vaultId),
    isPending: pending,
    error: query.isError || mutation.isError,
    refresh: () => { mutation.reset(); return query.refetch({ throwOnError: true }); },
    save: (entry: VaultBookmark) => mutation.mutateAsync(() => saveVaultBookmark(entry, context)),
    remove: (id: string) => mutation.mutateAsync(() => deleteVaultBookmark(id, context)),
    reorder: (ids: readonly string[]) => mutation.mutateAsync(() => reorderVaultBookmarks(ids, context)),
    setSortMode: (mode: BookmarkSortMode) => mutation.mutateAsync(() => sortVaultBookmarks(mode, context)),
    setPage: (pageId: string, label: string, enabled: boolean) => mutation.mutateAsync(() => setVaultPageBookmark(pageId, label, enabled, context)),
    setRoute: (target: string, label: string, enabled: boolean) => mutation.mutateAsync(() => setVaultRouteBookmark(target, label, enabled, context)),
  };
}
