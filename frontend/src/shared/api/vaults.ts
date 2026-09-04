import type { components, operations } from '../../generated/openapi';
import { bootstrapQueryKeys } from './bootstrap-query-keys';
import { fetchCachedQuery, invalidateCachedQuery } from './cached-query';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';

export {
  bulkApplyVaultTemplate,
  createVaultPage,
  deleteVaultPage,
  duplicateVaultPage,
  patchVaultPage,
  restoreVaultPage,
  saveVaultPage,
} from './vault-page-mutations';

export {
  createVault,
  deleteVault,
  fetchVaultCatalog,
  fetchVaultCatalogUncached,
  invalidateVaultCatalog,
  renameVault,
} from './vault-catalog';
export type {
  VaultCatalog,
  VaultDeletion,
  VaultMutation,
} from './vault-catalog';
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
export type VaultTablePropertyPatchInput =
  components['schemas']['TablePropertyPatchRequest'];
export type VaultTablePropertyPatchResult =
  components['schemas']['TablePropertyPatchResponse'];
export type VaultTableDeleteQuery = NonNullable<
  operations[
    'delete_table_api_vault_tables__table_id__delete'
  ]['parameters']['query']
>;
export type VaultPageSummary = components['schemas']['PageInfo'];
export type VaultSidebarPageSummary = components['schemas']['SidebarPageInfo'];
type VaultSidebarTreePage = components['schemas']['SidebarTreePageInfo'];
export type VaultPage = components['schemas']['PageDetailResponse'];
export type VaultPageMutation = components['schemas']['PageMutationResponse'];
export type VaultPageDeletion = components['schemas']['PageDeleteResponse'];
export type VaultPageDuplicate = components['schemas']['PageDuplicateResponse'];
export type VaultBulkTemplateInput = components['schemas']['BulkApplyTemplateRequest'];
export type VaultBulkTemplateResult = components['schemas']['BulkPageMutationResponse'];
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
  return fetchCachedQuery({
    queryKey: bootstrapQueryKeys.vaultRegistry(),
    signal,
    staleTime: 0,
    queryFn: async (sharedSignal) => unwrapApiResult<VaultRegistry, unknown>(
      await apiClient.GET('/api/vault/registry', { signal: sharedSignal }),
    ),
  });
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


export async function patchVaultTableProperty(
  tableId: string,
  fieldId: string,
  input: VaultTablePropertyPatchInput,
): Promise<VaultTablePropertyPatchResult> {
  return unwrapApiResult<VaultTablePropertyPatchResult, unknown>(
    await apiClient.PATCH(
      '/api/vault/tables/{table_id}/properties/{field_id}',
      {
        body: input,
        params: { path: { field_id: fieldId, table_id: tableId } },
      },
    ),
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


export async function fetchVaultSidebarSummary(
  signal?: AbortSignal,
): Promise<VaultSidebarPageSummary[]> {
  const pages = await fetchCachedQuery({
    queryKey: bootstrapQueryKeys.vaultSidebar(),
    signal,
    // Route transitions can remount Knowledge consumers sequentially after the
    // first promise has settled. Reuse the immutable projection briefly instead
    // of downloading the complete tree again.
    staleTime: 15_000,
    queryFn: async (sharedSignal) => unwrapApiResult<VaultSidebarTreePage[], unknown>(
      await apiClient.GET('/api/vault/sidebar/tree', { signal: sharedSignal }),
    ),
  });
  return pages.map((page) => ({
    ...page,
    parent_id: page.parent_id ?? null,
    is_database: page.is_database ?? false,
    metadata: page.metadata ?? {},
    folder: page.folder ?? '',
    resolved_table_id: page.resolved_table_id ?? null,
  }));
}


export async function invalidateVaultSidebarSummary(): Promise<void> {
  await invalidateCachedQuery(bootstrapQueryKeys.vaultSidebar());
}


async function invalidateSidebarAfter<T>(request: Promise<T>): Promise<T> {
  const result = await request;
  await invalidateVaultSidebarSummary();
  return result;
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
  return invalidateSidebarAfter(unwrapApiResult<VaultPageMutation, unknown>(
    await apiClient.POST('/api/vault/pages', {
      body: materializeVaultPageSaveRequest(input),
    }),
  ));
}


export async function saveVaultPage(
  pageId: string,
  input: VaultPageSaveInput,
): Promise<VaultPageMutation> {
  return invalidateSidebarAfter(unwrapApiResult<VaultPageMutation, unknown>(
    await apiClient.PUT('/api/vault/pages/{page_id}', {
      body: materializeVaultPageSaveRequest(input),
      params: { path: { page_id: pageId } },
    }),
  ));
}


export async function patchVaultPage(
  pageId: string,
  input: VaultPagePatchInput,
): Promise<VaultPageMutation> {
  return invalidateSidebarAfter(unwrapApiResult<VaultPageMutation, unknown>(
    await apiClient.PATCH('/api/vault/pages/{page_id}', {
      body: materializeVaultPagePatchRequest(input),
      params: { path: { page_id: pageId } },
    }),
  ));
}


export async function deleteVaultPage(
  pageId: string,
): Promise<VaultPageDeletion> {
  return invalidateSidebarAfter(unwrapApiResult<VaultPageDeletion, unknown>(
    await apiClient.DELETE('/api/vault/pages/{page_id}', {
      params: { path: { page_id: pageId } },
    }),
  ));
}


export async function duplicateVaultPage(
  pageId: string,
): Promise<VaultPageDuplicate> {
  return invalidateSidebarAfter(unwrapApiResult<VaultPageDuplicate, unknown>(
    await apiClient.POST('/api/vault/pages/{page_id}/duplicate', {
      params: { path: { page_id: pageId } },
    }),
  ));
}


export async function bulkApplyVaultTemplate(
  input: VaultBulkTemplateInput,
): Promise<VaultBulkTemplateResult> {
  return invalidateSidebarAfter(unwrapApiResult<VaultBulkTemplateResult, unknown>(
    await apiClient.POST('/api/vault/bulk-apply-template', { body: input }),
  ));
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
  return invalidateSidebarAfter(unwrapApiResult<VaultPageRestore, unknown>(
    await apiClient.POST('/api/vault/pages/{page_id}/restore', {
      params: { path: { page_id: pageId } },
    }),
  ));
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
