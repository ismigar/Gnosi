import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult, type ApiResult } from './errors';


export type JsonRecord = components['schemas']['RegistryRecord'];
export type VaultPageMutation = components['schemas']['PageMutationResponse'];
export type VaultPageSaveRequest = components['schemas']['PageSaveRequest'];
export type VaultPagePatchRequest = components['schemas']['PagePatchRequest'];
export type BulkPageMutation = components['schemas']['BulkPageMutationResponse'];
export type VaultView = components['schemas']['VaultViewResponse'];
export type VaultViewInput = components['schemas']['VaultViewInput'];
export type ViewMutation = components['schemas']['ViewMutationResponse'];
export type ViewReorderInput = components['schemas']['ViewReorderRequest'];
export type ViewReorderResult = components['schemas']['ViewReorderResponse'];
export type ViewUsage = components['schemas']['ViewUsageResponse'];

export interface EmbeddedPageCreateInput {
  content: string;
  metadata: JsonRecord;
  title: string;
}

export type PageViewsResponse = JsonRecord & {
  page_id: string;
  sections: JsonRecord[];
};


function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function requireJsonRecord(value: unknown, label: string): JsonRecord {
  if (!isJsonRecord(value)) {
    throw new TypeError(`The ${label} API returned an invalid JSON object`);
  }
  return value;
}


function unwrapJsonRecord(
  result: ApiResult<unknown>,
  label: string,
): JsonRecord {
  return requireJsonRecord(unwrapApiResult<unknown, unknown>(result), label);
}


export async function createEmbeddedVaultPage(
  input: EmbeddedPageCreateInput,
  signal?: AbortSignal,
): Promise<VaultPageMutation> {
  return unwrapApiResult<VaultPageMutation, unknown>(
    await apiClient.POST('/api/vault/pages', {
      // Preserve the historical body exactly; backend defaults remain backend-owned.
      body: input as VaultPageSaveRequest,
      signal,
    }),
  );
}


export async function patchEmbeddedVaultPageMetadata(
  pageId: string,
  metadata: JsonRecord,
  signal?: AbortSignal,
): Promise<VaultPageMutation> {
  return unwrapApiResult<VaultPageMutation, unknown>(
    await apiClient.PATCH('/api/vault/pages/{page_id}', {
      // Preserve the historical partial PATCH without materializing defaults.
      body: { metadata } as VaultPagePatchRequest,
      params: { path: { page_id: pageId } },
      signal,
    }),
  );
}


export async function fetchPageViews(
  pageId: string,
  signal?: AbortSignal,
): Promise<PageViewsResponse> {
  const payload = unwrapJsonRecord(
    await apiClient.GET('/api/pages/{page_id}/views', {
      params: { path: { page_id: pageId } },
      signal,
    }),
    'page views',
  );
  if (typeof payload.page_id !== 'string') {
    throw new TypeError('The page views API returned an invalid page ID');
  }
  if (!Array.isArray(payload.sections) || !payload.sections.every(isJsonRecord)) {
    throw new TypeError('The page views API returned invalid sections');
  }
  return {
    ...payload,
    page_id: payload.page_id,
    sections: payload.sections,
  };
}


export async function upsertPageView(
  pageId: string,
  section: JsonRecord,
  signal?: AbortSignal,
): Promise<JsonRecord> {
  return unwrapJsonRecord(
    await apiClient.POST('/api/pages/{page_id}/views', {
      body: section as components['schemas']['ViewSection'],
      params: { path: { page_id: pageId } },
      signal,
    }),
    'page view upsert',
  );
}


export async function fetchVaultViews(
  tableId?: string,
  signal?: AbortSignal,
): Promise<VaultView[]> {
  return unwrapApiResult<VaultView[], unknown>(
    await apiClient.GET('/api/vault/views', {
      params: { query: { table_id: tableId } },
      signal,
    }),
  );
}


export async function createVaultView(
  input: VaultViewInput,
  signal?: AbortSignal,
): Promise<VaultView> {
  return unwrapApiResult<VaultView, unknown>(
    await apiClient.POST('/api/vault/views', { body: input, signal }),
  );
}


export async function fetchVaultView(
  viewId: string,
  signal?: AbortSignal,
): Promise<VaultView> {
  return unwrapApiResult<VaultView, unknown>(
    await apiClient.GET('/api/vault/views/{view_id}', {
      params: { path: { view_id: viewId } },
      signal,
    }),
  );
}


export async function fetchVaultViewUsage(
  viewId: string,
  signal?: AbortSignal,
): Promise<ViewUsage> {
  return unwrapApiResult<ViewUsage, unknown>(
    await apiClient.GET('/api/vault/views/{view_id}/usage', {
      params: { path: { view_id: viewId } },
      signal,
    }),
  );
}


export async function updateVaultView(
  viewId: string,
  input: VaultViewInput,
  signal?: AbortSignal,
): Promise<ViewMutation> {
  return unwrapApiResult<ViewMutation, unknown>(
    await apiClient.PUT('/api/vault/views/{view_id}', {
      body: input,
      params: { path: { view_id: viewId } },
      signal,
    }),
  );
}


export async function deleteVaultView(
  viewId: string,
  signal?: AbortSignal,
): Promise<ViewMutation> {
  return unwrapApiResult<ViewMutation, unknown>(
    await apiClient.DELETE('/api/vault/views/{view_id}', {
      params: { path: { view_id: viewId } },
      signal,
    }),
  );
}


export async function reorderVaultViews(
  input: ViewReorderInput,
  signal?: AbortSignal,
): Promise<ViewReorderResult> {
  return unwrapApiResult<ViewReorderResult, unknown>(
    await apiClient.PUT('/api/vault/views/order', { body: input, signal }),
  );
}


export async function applyVaultTemplate(
  pageIds: string[],
  templateId: string,
  signal?: AbortSignal,
): Promise<BulkPageMutation> {
  return unwrapApiResult<BulkPageMutation, unknown>(
    await apiClient.POST('/api/vault/bulk-apply-template', {
      body: { page_ids: pageIds, template_id: templateId },
      signal,
    }),
  );
}
