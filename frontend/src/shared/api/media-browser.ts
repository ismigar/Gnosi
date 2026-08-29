import type { components, paths } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type MediaRoot = components['schemas']['MediaRootResponse'];
export type MediaTreeNode = components['schemas']['MediaTreeNodeResponse'];
export type MediaItem = components['schemas']['MediaItemResponse'];
export type MediaPage = components['schemas']['MediaPageResponse'];
export type MediaPageQuery = NonNullable<
  paths['/api/vault/media']['get']['parameters']['query']
>;


export const MEDIA_ROOTS_TIMEOUT_MS = 15_000;
export const MEDIA_TREE_TIMEOUT_MS = 30_000;
export const MEDIA_PAGE_TIMEOUT_MS = 300_000;


async function withTimeout<T>(
  timeoutMs: number,
  signal: AbortSignal | undefined,
  request: (timedSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abortFromCaller = () => {
    controller.abort(signal?.reason);
  };
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = globalThis.setTimeout(() => {
    controller.abort(new Error(`timeout of ${String(timeoutMs)}ms exceeded`));
  }, timeoutMs);

  try {
    return await request(controller.signal);
  } finally {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}


export async function fetchMediaRoots(
  signal?: AbortSignal,
): Promise<MediaRoot[]> {
  return withTimeout(MEDIA_ROOTS_TIMEOUT_MS, signal, async (timedSignal) => (
    unwrapApiResult<MediaRoot[], unknown>(
      await apiClient.GET('/api/vault/media/roots', { signal: timedSignal }),
    )
  ));
}


export async function fetchMediaTree(
  root: string,
  path?: string,
  signal?: AbortSignal,
): Promise<MediaTreeNode[]> {
  return withTimeout(MEDIA_TREE_TIMEOUT_MS, signal, async (timedSignal) => (
    unwrapApiResult<MediaTreeNode[], unknown>(
      await apiClient.GET('/api/vault/media/tree', {
        params: { query: { path, root } },
        signal: timedSignal,
      }),
    )
  ));
}


export async function fetchMediaPage(
  query: MediaPageQuery,
  signal?: AbortSignal,
): Promise<MediaPage> {
  return withTimeout(MEDIA_PAGE_TIMEOUT_MS, signal, async (timedSignal) => (
    unwrapApiResult<MediaPage, unknown>(
      await apiClient.GET('/api/vault/media', {
        params: { query },
        signal: timedSignal,
      }),
    )
  ));
}
