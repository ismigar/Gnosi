import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { GnosiApiError, unwrapApiResult } from './errors';
import { transportFetch } from './transports';


type JsonRecord = Record<string, unknown>;

export type PluginSettingsResponse =
  components['schemas']['PluginSettingsResponse'];
export type PluginHostPage = components['schemas']['PageDetailResponse'];
export type PluginHostPageMutation =
  components['schemas']['PageMutationResponse'];
export type PluginHostPagePatchInput = Partial<
  components['schemas']['PagePatchRequest']
>;
export type PluginHostPageCreateInput = Pick<
  components['schemas']['PageSaveRequest'],
  'content' | 'metadata' | 'title'
> &
  Partial<
    Omit<
      components['schemas']['PageSaveRequest'],
      'content' | 'metadata' | 'title'
    >
  >;


export interface PluginHostPagePatchOptions {
  readonly knownEtag?: string | null;
  readonly signal?: AbortSignal;
}


export interface PluginNetworkResponse extends JsonRecord {
  readonly body: string;
  readonly contentType: string;
  readonly status: number;
}


interface PageEtagConflictDetail {
  readonly currentEtag?: string;
  readonly expectedEtag?: string;
  readonly message?: string;
}


const pluginHostPageEtags = new Map<string, string>();


function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}


function responseEtag(value: unknown): string | null {
  return isRecord(value) && typeof value.etag === 'string' && value.etag
    ? value.etag
    : null;
}


function rememberPluginHostPageEtag(pageId: string, value: unknown): void {
  const etag = typeof value === 'string' ? value : responseEtag(value);
  if (etag) pluginHostPageEtags.set(pageId, etag);
}


function pageEtagConflict(error: unknown): PageEtagConflictDetail | null {
  if (!(error instanceof GnosiApiError) || error.status !== 409) return null;
  if (!isRecord(error.payload) || !isRecord(error.payload.detail)) return null;
  const detail = error.payload.detail;
  if (
    detail.error !== 'etag_mismatch' &&
    detail.error !== 'etag_mismatch_force'
  ) {
    return null;
  }
  return {
    currentEtag:
      typeof detail.current_etag === 'string' ? detail.current_etag : undefined,
    expectedEtag:
      typeof detail.expected_etag === 'string' ? detail.expected_etag : undefined,
    message: typeof detail.message === 'string' ? detail.message : undefined,
  };
}


function dispatchPreviewInvalidation(pageId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('gnosi:invalidatePreview', { detail: { pageId } }),
  );
}


function dispatchPageEtagConflict(
  pageId: string,
  detail: PageEtagConflictDetail,
  requestBody: PluginHostPagePatchInput,
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('pageEtagConflict', {
      detail: {
        pageId,
        currentEtag: detail.currentEtag,
        expectedEtag: detail.expectedEtag,
        message: detail.message,
        originalRequest: {
          data: requestBody,
          method: 'patch',
          url: `/api/vault/pages/${encodeURIComponent(pageId)}`,
        },
      },
    }),
  );
}


function isPluginNetworkResponse(value: unknown): value is PluginNetworkResponse {
  return (
    isRecord(value) &&
    typeof value.status === 'number' &&
    typeof value.body === 'string' &&
    typeof value.contentType === 'string'
  );
}


async function errorPayload(response: Response): Promise<unknown> {
  const raw = await response.text().catch(() => '');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}


async function assertTransportSuccess(response: Response): Promise<void> {
  if (!response.ok) {
    throw new GnosiApiError(response, await errorPayload(response));
  }
}


async function sendPluginHostPagePatch(
  pageId: string,
  input: PluginHostPagePatchInput,
  signal?: AbortSignal,
): Promise<PluginHostPageMutation> {
  const body = input as components['schemas']['PagePatchRequest'];
  return unwrapApiResult<PluginHostPageMutation, unknown>(
    await apiClient.PATCH('/api/vault/pages/{page_id}', {
      body,
      params: { path: { page_id: pageId } },
      signal,
    }),
  );
}


export async function fetchPluginHostPage(
  pageId: string,
  signal?: AbortSignal,
): Promise<PluginHostPage> {
  const page = unwrapApiResult<PluginHostPage, unknown>(
    await apiClient.GET('/api/vault/pages/{page_id}', {
      params: { path: { page_id: pageId } },
      signal,
    }),
  );
  rememberPluginHostPageEtag(pageId, page);
  return page;
}


export async function createPluginHostPage(
  input: PluginHostPageCreateInput,
  signal?: AbortSignal,
): Promise<PluginHostPageMutation> {
  const body = input as components['schemas']['PageSaveRequest'];
  return unwrapApiResult<PluginHostPageMutation, unknown>(
    await apiClient.POST('/api/vault/pages', { body, signal }),
  );
}


export async function patchPluginHostPage(
  pageId: string,
  input: PluginHostPagePatchInput,
  options: PluginHostPagePatchOptions = {},
): Promise<PluginHostPageMutation> {
  if (options.knownEtag) {
    rememberPluginHostPageEtag(pageId, options.knownEtag);
  }
  const cachedEtag = pluginHostPageEtags.get(pageId);
  const shouldAttachEtag =
    Boolean(cachedEtag) &&
    !Object.hasOwn(input, 'expected_etag') &&
    input.force !== true;
  const requestBody = shouldAttachEtag
    ? { ...input, expected_etag: cachedEtag }
    : input;

  try {
    const saved = await sendPluginHostPagePatch(
      pageId,
      requestBody,
      options.signal,
    );
    rememberPluginHostPageEtag(pageId, saved);
    dispatchPreviewInvalidation(pageId);
    return saved;
  } catch (error) {
    const conflict = pageEtagConflict(error);
    if (!conflict) throw error;
    if (conflict.currentEtag) {
      rememberPluginHostPageEtag(pageId, conflict.currentEtag);
    }
    dispatchPageEtagConflict(pageId, conflict, requestBody);
    throw error;
  }
}


export function clearPluginHostPageEtag(pageId: string): void {
  pluginHostPageEtags.delete(pageId);
}


export async function fetchPluginSettings(
  pluginId: string,
  signal?: AbortSignal,
): Promise<PluginSettingsResponse> {
  return unwrapApiResult<PluginSettingsResponse, unknown>(
    await apiClient.GET('/api/vault/plugins/{plugin_id}/settings', {
      params: { path: { plugin_id: pluginId } },
      signal,
    }),
  );
}


export async function updatePluginSettings(
  pluginId: string,
  settings: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<PluginSettingsResponse> {
  return unwrapApiResult<PluginSettingsResponse, unknown>(
    await apiClient.PUT('/api/vault/plugins/{plugin_id}/settings', {
      body: { settings },
      params: { path: { plugin_id: pluginId } },
      signal,
    }),
  );
}


export async function fetchForUiPlugin(
  pluginId: string,
  url: string,
  opts: Readonly<Record<string, unknown>> = {},
  signal?: AbortSignal,
): Promise<PluginNetworkResponse> {
  const result = await apiClient.POST(
    '/api/vault/plugins/{plugin_id}/network/fetch',
    {
      body: { opts, url },
      params: { path: { plugin_id: pluginId } },
      signal,
    },
  );
  if (!result.response.ok || result.error !== undefined) {
    throw new GnosiApiError(result.response, result.error);
  }
  if (!isPluginNetworkResponse(result.data)) {
    throw new GnosiApiError(
      result.response,
      'The API returned an invalid plugin network response',
    );
  }
  return result.data;
}


export async function fetchPluginAssetText(
  pluginId: string,
  assetPath: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await transportFetch(
    `/api/vault/plugins/${encodeURIComponent(pluginId)}/asset/${assetPath}`,
    { method: 'GET', signal },
  );
  await assertTransportSuccess(response);
  return response.text();
}


export async function uploadPluginZip(
  file: File,
  signal?: AbortSignal,
): Promise<void> {
  const body = new FormData();
  body.set('file', file);
  const response = await transportFetch('/api/vault/plugins/install', {
    body,
    method: 'POST',
    signal,
  });
  await assertTransportSuccess(response);
}


export async function exportPluginPackage(
  pluginId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await transportFetch(
    `/api/vault/plugins/${encodeURIComponent(pluginId)}/export`,
    {
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal,
    },
  );
  await assertTransportSuccess(response);
  return response.blob();
}
