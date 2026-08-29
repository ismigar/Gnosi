import type { components, operations } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type VaultCatalog = components['schemas']['VaultListResponse'];
export type VaultMutation = components['schemas']['VaultMutationResponse'];
export type VaultDeletion = components['schemas']['VaultDeleteResponse'];
export type VaultSummary = components['schemas']['VaultSummaryResponse'];
export type VaultRegistry = components['schemas']['VaultRegistryResponse'];
export type VaultRegistryRecord = components['schemas']['RegistryRecord'];
export type VaultGlobalIndex = components['schemas']['GlobalIndexResponse'];
export type VaultAliasIndex = components['schemas']['AliasIndexResponse'];
export type VaultDatabaseInput = operations[
  'create_database_api_vault_databases_post'
]['requestBody']['content']['application/json'];
export type VaultTableInput = operations[
  'create_table_api_vault_tables_post'
]['requestBody']['content']['application/json'];
export type VaultTableRenameInput = operations[
  'rename_table_api_vault_tables__table_id__put'
]['requestBody']['content']['application/json'];
export type VaultTableDeleteQuery = NonNullable<
  operations[
    'delete_table_api_vault_tables__table_id__delete'
  ]['parameters']['query']
>;
export type VaultPageSummary = components['schemas']['PageInfo'];
export type VaultPage = components['schemas']['PageDetailResponse'];
export type VaultPageMutation = components['schemas']['PageMutationResponse'];
export type VaultPageDeletion = components['schemas']['PageDeleteResponse'];
export type VaultPagePreview = components['schemas']['PagePreviewResponse'];
export type VaultPagePreviewWarmRequest =
  components['schemas']['_BulkWarmPayload'];
export type VaultPagePreviewWarmResult =
  components['schemas']['BulkPreviewWarmResponse'];
export type VaultPageSaveRequest = components['schemas']['PageSaveRequest'];
export type VaultPagePatchRequest = components['schemas']['PagePatchRequest'];
export type VaultPageSaveInput = Pick<
  VaultPageSaveRequest,
  'content' | 'title'
> &
  Partial<Omit<VaultPageSaveRequest, 'content' | 'title'>>;
export type VaultPagePatchInput = Partial<VaultPagePatchRequest>;
export type VaultPagesQuery = NonNullable<
  operations['list_pages_api_vault_pages_get']['parameters']['query']
>;
export type VaultTablePagesQuery = NonNullable<
  operations[
    'list_pages_by_table_api_vault_pages_by_table__table_id__get'
  ]['parameters']['query']
>;
export type VaultTablePagesSnapshot =
  components['schemas']['TablePagesSnapshot'];
export type VaultPagePreviewQuery = NonNullable<
  operations[
    'get_page_preview_api_vault_pages__page_id__preview_get'
  ]['parameters']['query']
>;
export type VaultLocalPathOpenRequest =
  components['schemas']['LocalPathOpenRequest'];
export type VaultLocalPathOpenResult =
  components['schemas']['LocalPathOpenResponse'];
export type VaultResourceOpenRequest =
  components['schemas']['OpenResourceRequest'];
export type VaultResourceOpenResult =
  components['schemas']['ResourceOpenResponse'];
export type VaultTitleResolution =
  components['schemas']['ResolveByTitleResponse'];
export type VaultTrashEntry = components['schemas']['TrashEntry'];
export type VaultTrash = components['schemas']['TrashListResponse'];
export type VaultPageRestore = components['schemas']['PageRestoreResponse'];
export type VaultTrashPurge = components['schemas']['TrashPurgeResponse'];
export type VaultTrashEmpty = components['schemas']['TrashEmptyResponse'];
export type VaultTrashQuery = NonNullable<
  operations['list_trash_api_vault_trash_get']['parameters']['query']
>;


function materializeVaultPageSaveRequest(
  input: VaultPageSaveInput,
): VaultPageSaveRequest {
  return {
    force: false,
    is_database: false,
    metadata: {},
    ...input,
  };
}


function materializeVaultPagePatchRequest(
  input: VaultPagePatchInput,
): VaultPagePatchRequest {
  return { force: false, ...input };
}


export async function fetchVaultCatalog(
  signal?: AbortSignal,
): Promise<VaultCatalog> {
  return unwrapApiResult<VaultCatalog, unknown>(
    await apiClient.GET('/api/vaults', { signal }),
  );
}


export async function fetchVaultDatabases(
  signal?: AbortSignal,
): Promise<VaultRegistryRecord[]> {
  return unwrapApiResult<VaultRegistryRecord[], unknown>(
    await apiClient.GET('/api/vault/databases', { signal }),
  );
}


export async function createVaultDatabase(
  input: VaultDatabaseInput,
): Promise<VaultRegistryRecord> {
  return unwrapApiResult<VaultRegistryRecord, unknown>(
    await apiClient.POST('/api/vault/databases', { body: input }),
  );
}


export async function deleteVaultDatabase(
  databaseId: string,
): Promise<VaultRegistryRecord> {
  return unwrapApiResult<VaultRegistryRecord, unknown>(
    await apiClient.DELETE('/api/vault/databases/{database_id}', {
      params: { path: { database_id: databaseId } },
    }),
  );
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


export async function fetchVaultRegistry(
  signal?: AbortSignal,
): Promise<VaultRegistry> {
  return unwrapApiResult<VaultRegistry, unknown>(
    await apiClient.GET('/api/vault/registry', { signal }),
  );
}


export async function createVaultTable(
  input: VaultTableInput,
): Promise<VaultRegistryRecord> {
  return unwrapApiResult<VaultRegistryRecord, unknown>(
    await apiClient.POST('/api/vault/tables', { body: input }),
  );
}


export async function renameVaultTable(
  tableId: string,
  input: VaultTableRenameInput,
): Promise<VaultRegistryRecord> {
  return unwrapApiResult<VaultRegistryRecord, unknown>(
    await apiClient.PUT('/api/vault/tables/{table_id}', {
      body: input,
      params: { path: { table_id: tableId } },
    }),
  );
}


export async function deleteVaultTable(
  tableId: string,
  query: VaultTableDeleteQuery = {},
): Promise<VaultRegistryRecord> {
  return unwrapApiResult<VaultRegistryRecord, unknown>(
    await apiClient.DELETE('/api/vault/tables/{table_id}', {
      params: { path: { table_id: tableId }, query },
    }),
  );
}


export async function fetchVaultPages(
  query: VaultPagesQuery = {},
  signal?: AbortSignal,
): Promise<VaultPageSummary[]> {
  return unwrapApiResult<VaultPageSummary[], unknown>(
    await apiClient.GET('/api/vault/pages', {
      params: { query },
      signal,
    }),
  );
}


export async function fetchVaultPage(
  pageId: string,
  signal?: AbortSignal,
): Promise<VaultPage> {
  return unwrapApiResult<VaultPage, unknown>(
    await apiClient.GET('/api/vault/pages/{page_id}', {
      params: { path: { page_id: pageId } },
      signal,
    }),
  );
}


export async function fetchVaultPagesByTable(
  tableId: string,
  query: VaultTablePagesQuery = {},
  signal?: AbortSignal,
): Promise<VaultPageSummary[]> {
  return unwrapApiResult<VaultPageSummary[], unknown>(
    await apiClient.GET('/api/vault/pages/by-table/{table_id}', {
      params: { path: { table_id: tableId }, query },
      signal,
    }),
  );
}


export async function fetchVaultTablePagesSnapshot(
  tableId: string,
  signal?: AbortSignal,
): Promise<VaultTablePagesSnapshot> {
  return unwrapApiResult<VaultTablePagesSnapshot, unknown>(
    await apiClient.GET('/api/vault/pages/by-table/{table_id}/snapshot', {
      params: { path: { table_id: tableId } },
      signal,
    }),
  );
}


export async function fetchVaultPagePreview(
  pageId: string,
  query: VaultPagePreviewQuery = {},
  signal?: AbortSignal,
): Promise<VaultPagePreview> {
  return unwrapApiResult<VaultPagePreview, unknown>(
    await apiClient.GET('/api/vault/pages/{page_id}/preview', {
      params: { path: { page_id: pageId }, query },
      signal,
    }),
  );
}


export async function warmVaultPagePreviews(
  input: VaultPagePreviewWarmRequest,
): Promise<VaultPagePreviewWarmResult> {
  return unwrapApiResult<VaultPagePreviewWarmResult, unknown>(
    await apiClient.POST('/api/vault/pages/preview/warm', { body: input }),
  );
}


export async function createVaultPage(
  input: VaultPageSaveInput,
): Promise<VaultPageMutation> {
  return unwrapApiResult<VaultPageMutation, unknown>(
    await apiClient.POST('/api/vault/pages', {
      body: materializeVaultPageSaveRequest(input),
    }),
  );
}


export async function saveVaultPage(
  pageId: string,
  input: VaultPageSaveInput,
): Promise<VaultPageMutation> {
  return unwrapApiResult<VaultPageMutation, unknown>(
    await apiClient.PUT('/api/vault/pages/{page_id}', {
      body: materializeVaultPageSaveRequest(input),
      params: { path: { page_id: pageId } },
    }),
  );
}


export async function patchVaultPage(
  pageId: string,
  input: VaultPagePatchInput,
): Promise<VaultPageMutation> {
  return unwrapApiResult<VaultPageMutation, unknown>(
    await apiClient.PATCH('/api/vault/pages/{page_id}', {
      body: materializeVaultPagePatchRequest(input),
      params: { path: { page_id: pageId } },
    }),
  );
}


export async function deleteVaultPage(
  pageId: string,
): Promise<VaultPageDeletion> {
  return unwrapApiResult<VaultPageDeletion, unknown>(
    await apiClient.DELETE('/api/vault/pages/{page_id}', {
      params: { path: { page_id: pageId } },
    }),
  );
}


export async function resolveVaultTitle(
  title: string,
  signal?: AbortSignal,
): Promise<VaultTitleResolution> {
  return unwrapApiResult<VaultTitleResolution, unknown>(
    await apiClient.GET('/api/vault/resolve-by-title', {
      params: { query: { title } },
      signal,
    }),
  );
}


export async function fetchVaultTrash(
  query: VaultTrashQuery = {},
  signal?: AbortSignal,
): Promise<VaultTrash> {
  return unwrapApiResult<VaultTrash, unknown>(
    await apiClient.GET('/api/vault/trash', {
      params: { query },
      signal,
    }),
  );
}


export async function restoreVaultPage(
  pageId: string,
): Promise<VaultPageRestore> {
  return unwrapApiResult<VaultPageRestore, unknown>(
    await apiClient.POST('/api/vault/pages/{page_id}/restore', {
      params: { path: { page_id: pageId } },
    }),
  );
}


export async function purgeVaultTrashPage(
  pageId: string,
): Promise<VaultTrashPurge> {
  return unwrapApiResult<VaultTrashPurge, unknown>(
    await apiClient.DELETE('/api/vault/trash/{page_id}', {
      params: { path: { page_id: pageId } },
    }),
  );
}


export async function emptyVaultTrash(): Promise<VaultTrashEmpty> {
  return unwrapApiResult<VaultTrashEmpty, unknown>(
    await apiClient.DELETE('/api/vault/trash'),
  );
}


export async function openVaultLocalPath(
  input: VaultLocalPathOpenRequest,
): Promise<VaultLocalPathOpenResult> {
  return unwrapApiResult<VaultLocalPathOpenResult, unknown>(
    await apiClient.POST('/api/vault/open-local-path', { body: input }),
  );
}


export async function openVaultResource(
  input: VaultResourceOpenRequest,
): Promise<VaultResourceOpenResult> {
  return unwrapApiResult<VaultResourceOpenResult, unknown>(
    await apiClient.POST('/api/vault/open-resource', { body: input }),
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
