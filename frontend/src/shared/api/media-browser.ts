import type { components, operations, paths } from '../../generated/openapi';
import { apiClient } from './client';
import { GnosiApiError, unwrapApiResult } from './errors';
import { transportFetch } from './transports';
import { APP_PREVIEW_LIMIT, rememberAppPreview } from './app-previews';
import { currentRequestContext, requestContextHeaders } from './request-context';


export type MediaRoot = components['schemas']['MediaRootResponse'];
export type MediaTreeNode = components['schemas']['MediaTreeNodeResponse'];
export type MediaItem = components['schemas']['MediaItemResponse'];
export type MediaIndexState = 'fresh' | 'refreshing' | 'failed';
export type MediaPage = components['schemas']['MediaPageResponse'] & {
  readonly indexState?: MediaIndexState;
  readonly indexRevision?: string;
  readonly indexRetryAfter?: number;
  readonly nextOffset?: number;
};
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
  const scope = currentRequestContext();
  return withTimeout(timeoutMs, signal, async (timedSignal) => {
    const result = await apiClient.GET('/api/vault/media', {
        headers: requestContextHeaders(scope),
        params: { query },
        signal: timedSignal,
      });
    const page = unwrapApiResult<MediaPage, unknown>(result);
    const state = result.response.headers.get('X-Gnosi-Media-Index');
    // The index belongs to the gallery. Home can display its last complete, recent-first page.
    const latestPhotos = (!query.root || query.root === 'images') && !query.offset
      && Object.keys(query).every(field => ['root', 'offset', 'limit'].includes(field));
    if (latestPhotos && !timedSignal.aborted && (state === 'fresh' || state === null)) {
      rememberAppPreview('media', scope, page.items.slice(0, APP_PREVIEW_LIMIT).map(item => ({
        id: item.id, title: item.filename, detail: item.album, date: item.last_modified,
      })));
    }
    const revision = result.response.headers.get('X-Gnosi-Media-Index-Revision');
    const retryAfter = Number(result.response.headers.get('Retry-After'));
    const nextOffsetHeader = result.response.headers.get('X-Gnosi-Media-Next-Offset');
    const nextOffset = nextOffsetHeader !== null && /^\d+$/.test(nextOffsetHeader)
      ? Number(nextOffsetHeader) : undefined;
    return {
      ...page,
      ...(state === 'fresh' || state === 'refreshing' || state === 'failed' ? { indexState: state } : {}),
      ...(revision ? { indexRevision: revision } : {}),
      ...(nextOffset !== undefined && Number.isSafeInteger(nextOffset) ? { nextOffset } : {}),
      ...(state === 'failed' && Number.isFinite(retryAfter) && retryAfter > 0
        ? { indexRetryAfter: Math.min(300, Math.ceil(retryAfter)) } : {}),
    };
  });
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
