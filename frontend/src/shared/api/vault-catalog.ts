import type { components } from '../../generated/openapi';
import { bootstrapQueryKeys } from './bootstrap-query-keys';
import { fetchCachedQuery, invalidateCachedQuery } from './cached-query';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';

export type VaultCatalog = components['schemas']['VaultListResponse'];
export type VaultMutation = components['schemas']['VaultMutationResponse'];
export type VaultDeletion = components['schemas']['VaultDeleteResponse'];

export async function fetchVaultCatalog(
  signal?: AbortSignal,
): Promise<VaultCatalog> {
  return fetchCachedQuery({
    queryFn: fetchVaultCatalogUncached,
    queryKey: bootstrapQueryKeys.vaultCatalog,
    signal,
  });
}

export async function fetchVaultCatalogUncached(
  signal?: AbortSignal,
): Promise<VaultCatalog> {
  return unwrapApiResult<VaultCatalog, unknown>(
    await apiClient.GET('/api/vaults', { signal }),
  );
}

export async function invalidateVaultCatalog(): Promise<void> {
  await invalidateCachedQuery(bootstrapQueryKeys.vaultCatalog);
}

export async function createVault(
  name: string,
  path?: string,
): Promise<VaultMutation> {
  const result = unwrapApiResult<VaultMutation, unknown>(
    await apiClient.POST('/api/vaults', {
      body: path ? { name, path } : { name },
    }),
  );
  await invalidateVaultCatalog();
  return result;
}

export async function renameVault(
  vaultId: string,
  name: string,
): Promise<VaultMutation> {
  const result = unwrapApiResult<VaultMutation, unknown>(
    await apiClient.PATCH('/api/vaults/{vault_id}', {
      body: { name },
      params: { path: { vault_id: vaultId } },
    }),
  );
  await invalidateVaultCatalog();
  return result;
}

export async function deleteVault(
  vaultId: string,
  deleteFiles = false,
): Promise<VaultDeletion> {
  const result = unwrapApiResult<VaultDeletion, unknown>(
    await apiClient.DELETE('/api/vaults/{vault_id}', {
      params: {
        path: { vault_id: vaultId },
        query: { delete_files: deleteFiles },
      },
    }),
  );
  await invalidateVaultCatalog();
  return result;
}
