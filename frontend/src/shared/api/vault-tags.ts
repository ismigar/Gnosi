import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type VaultTagPage = components['schemas']['VaultTagPage'];
export type VaultTagSummary = components['schemas']['VaultTagSummary'];
export type VaultTags = components['schemas']['VaultTagsResponse'];


export async function fetchVaultTags(
  signal?: AbortSignal,
): Promise<VaultTags> {
  return unwrapApiResult<VaultTags, unknown>(
    await apiClient.GET('/api/vault/tags', { signal }),
  );
}
