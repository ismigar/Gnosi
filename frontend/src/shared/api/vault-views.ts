import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type VaultView = components['schemas']['VaultViewResponse'];
export type VaultViewInput = components['schemas']['VaultViewInput'];
export type ViewMutation = components['schemas']['ViewMutationResponse'];
export type ViewReorderInput = components['schemas']['ViewReorderRequest'];
export type ViewReorderResult = components['schemas']['ViewReorderResponse'];
export type ViewUsage = components['schemas']['ViewUsageResponse'];


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
