import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type VaultPageHistoryVersion =
  components['schemas']['PageHistoryVersion'];
export type VaultPageHistoryContent =
  components['schemas']['PageHistoryContent'];
export type VaultPageHistoryMutation =
  components['schemas']['PageHistoryMutationResponse'];


export async function fetchVaultPageHistory(
  pageId: string,
  signal?: AbortSignal,
): Promise<VaultPageHistoryVersion[]> {
  return unwrapApiResult<VaultPageHistoryVersion[], unknown>(
    await apiClient.GET('/api/vault/pages/{page_id}/history', {
      params: { path: { page_id: pageId } },
      signal,
    }),
  );
}


export async function fetchVaultPageHistoryVersion(
  pageId: string,
  versionId: string,
  signal?: AbortSignal,
): Promise<VaultPageHistoryContent> {
  return unwrapApiResult<VaultPageHistoryContent, unknown>(
    await apiClient.GET('/api/vault/pages/{page_id}/history/{timestamp}', {
      params: { path: { page_id: pageId, timestamp: versionId } },
      signal,
    }),
  );
}


export async function restoreVaultPageHistoryVersion(
  pageId: string,
  versionId: string,
): Promise<VaultPageHistoryMutation> {
  return unwrapApiResult<VaultPageHistoryMutation, unknown>(
    await apiClient.POST(
      '/api/vault/pages/{page_id}/history/restore/{timestamp}',
      { params: { path: { page_id: pageId, timestamp: versionId } } },
    ),
  );
}


export async function purgeVaultPageHistory(
  pageId: string,
): Promise<VaultPageHistoryMutation> {
  return unwrapApiResult<VaultPageHistoryMutation, unknown>(
    await apiClient.DELETE('/api/vault/pages/{page_id}/history', {
      params: { path: { page_id: pageId } },
    }),
  );
}
