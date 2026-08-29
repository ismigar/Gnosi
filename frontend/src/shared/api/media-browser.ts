import type { components, operations, paths } from '../../generated/openapi';
import { apiClient } from './client';
import { GnosiApiError, unwrapApiResult } from './errors';
import { transportFetch } from './transports';


export type MediaRoot = components['schemas']['MediaRootResponse'];
export type MediaTreeNode = components['schemas']['MediaTreeNodeResponse'];
export type MediaItem = components['schemas']['MediaItemResponse'];
export type MediaPage = components['schemas']['MediaPageResponse'];
export type MediaPageQuery = NonNullable<
  paths['/api/vault/media']['get']['parameters']['query']
>;
export type MediaMutation = components['schemas']['MediaMutationResponse'];
export type MediaView = components['schemas']['MediaViewResponse'];
export type MediaViewInput = components['schemas']['MediaViewInput'];
export type MediaMetadataInput = operations[
  'update_media_metadata_api_vault_media_metadata_patch'
]['requestBody']['content']['application/json'];


export const MEDIA_ROOTS_TIMEOUT_MS = 15_000;
export const MEDIA_TREE_TIMEOUT_MS = 30_000;
export const MEDIA_PAGE_TIMEOUT_MS = 300_000;
export const MEDIA_VIEW_TIMEOUT_MS = 15_000;


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
  timeoutMs = MEDIA_PAGE_TIMEOUT_MS,
): Promise<MediaPage> {
  return withTimeout(timeoutMs, signal, async (timedSignal) => (
    unwrapApiResult<MediaPage, unknown>(
      await apiClient.GET('/api/vault/media', {
        params: { query },
        signal: timedSignal,
      }),
    )
  ));
}


export async function fetchMediaViews(
  signal?: AbortSignal,
): Promise<MediaView[]> {
  return withTimeout(MEDIA_VIEW_TIMEOUT_MS, signal, async (timedSignal) => (
    unwrapApiResult<MediaView[], unknown>(
      await apiClient.GET('/api/vault/media/views', { signal: timedSignal }),
    )
  ));
}


export async function createMediaView(
  input: MediaViewInput,
  signal?: AbortSignal,
): Promise<MediaView> {
  return unwrapApiResult<MediaView, unknown>(
    await apiClient.POST('/api/vault/media/views', { body: input, signal }),
  );
}


export async function updateMediaView(
  viewId: string,
  input: MediaViewInput,
  signal?: AbortSignal,
): Promise<MediaView> {
  return unwrapApiResult<MediaView, unknown>(
    await apiClient.PATCH('/api/vault/media/views/{view_id}', {
      body: input,
      params: { path: { view_id: viewId } },
      signal,
    }),
  );
}


export async function deleteMediaView(
  viewId: string,
  signal?: AbortSignal,
): Promise<MediaMutation> {
  return unwrapApiResult<MediaMutation, unknown>(
    await apiClient.DELETE('/api/vault/media/views/{view_id}', {
      params: { path: { view_id: viewId } },
      signal,
    }),
  );
}


export async function updateMediaMetadata(
  input: MediaMetadataInput,
  signal?: AbortSignal,
): Promise<MediaMutation> {
  return unwrapApiResult<MediaMutation, unknown>(
    await apiClient.PATCH('/api/vault/media/metadata', { body: input, signal }),
  );
}


function isMediaItem(value: unknown): value is MediaItem {
  if (value === null || typeof value !== 'object') return false;
  return 'id' in value
    && 'filename' in value
    && 'url' in value;
}


export async function uploadMediaFile(
  file: File,
  album: string,
  signal?: AbortSignal,
): Promise<MediaItem> {
  const body = new FormData();
  body.set('file', file);
  const query = new URLSearchParams({ album });
  const response = await transportFetch(`/api/vault/media/upload?${query}`, {
    body,
    method: 'POST',
    signal,
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new GnosiApiError(response, payload);
  if (!isMediaItem(payload)) {
    throw new GnosiApiError(response, 'The API returned an invalid media upload');
  }
  return payload;
}
