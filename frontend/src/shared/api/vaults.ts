import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type VaultCatalog = components['schemas']['VaultListResponse'];
export type VaultMutation = components['schemas']['VaultMutationResponse'];
export type VaultDeletion = components['schemas']['VaultDeleteResponse'];
export type VaultSummary = components['schemas']['VaultSummaryResponse'];
export type VaultRegistryRecord = components['schemas']['RegistryRecord'];
export type VaultGlobalIndex = components['schemas']['GlobalIndexResponse'];
export type VaultAliasIndex = components['schemas']['AliasIndexResponse'];


export async function fetchVaultCatalog(): Promise<VaultCatalog> {
  return unwrapApiResult<VaultCatalog, unknown>(await apiClient.GET('/api/vaults'));
}


export async function fetchVaultTables(
  databaseId?: string,
  signal?: AbortSignal,
): Promise<VaultRegistryRecord[]> {
  return unwrapApiResult<VaultRegistryRecord[], unknown>(
    await apiClient.GET('/api/vault/tables', {
      params: { query: { database_id: databaseId } },
      signal,
    }),
  );
}


export async function fetchVaultGlobalIndex(
  signal?: AbortSignal,
): Promise<VaultGlobalIndex> {
  return unwrapApiResult<VaultGlobalIndex, unknown>(
    await apiClient.GET('/api/vault/global-index', { signal }),
  );
}


export async function fetchVaultAliasIndex(
  signal?: AbortSignal,
): Promise<VaultAliasIndex> {
  return unwrapApiResult<VaultAliasIndex, unknown>(
    await apiClient.GET('/api/vault/alias-index', { signal }),
  );
}


export async function createVault(name: string, path?: string): Promise<VaultMutation> {
  return unwrapApiResult<VaultMutation, unknown>(
    await apiClient.POST('/api/vaults', {
      body: path ? { name, path } : { name },
    }),
  );
}


export async function renameVault(vaultId: string, name: string): Promise<VaultMutation> {
  return unwrapApiResult<VaultMutation, unknown>(
    await apiClient.PATCH('/api/vaults/{vault_id}', {
      body: { name },
      params: { path: { vault_id: vaultId } },
    }),
  );
}


export async function deleteVault(
  vaultId: string,
  deleteFiles = false,
): Promise<VaultDeletion> {
  return unwrapApiResult<VaultDeletion, unknown>(
    await apiClient.DELETE('/api/vaults/{vault_id}', {
      params: {
        path: { vault_id: vaultId },
        query: { delete_files: deleteFiles },
      },
    }),
  );
}
