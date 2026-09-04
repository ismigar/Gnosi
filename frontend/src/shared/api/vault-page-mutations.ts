import type { components } from '../../generated/openapi';
import { bootstrapQueryKeys } from './bootstrap-query-keys';
import { invalidateCachedQuery } from './cached-query';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';

type VaultPageSaveRequest = components['schemas']['PageSaveRequest'];
type VaultPagePatchRequest = components['schemas']['PagePatchRequest'];
type VaultPageSaveInput = Pick<VaultPageSaveRequest, 'content' | 'title'> &
  Partial<Omit<VaultPageSaveRequest, 'content' | 'title'>>;
type VaultPagePatchInput = Partial<VaultPagePatchRequest>;
type VaultPageMutation = components['schemas']['PageMutationResponse'];
type VaultPageDeletion = components['schemas']['PageDeleteResponse'];
type VaultPageDuplicate = components['schemas']['PageDuplicateResponse'];
type VaultBulkTemplateInput = components['schemas']['BulkApplyTemplateRequest'];
type VaultBulkTemplateResult = components['schemas']['BulkPageMutationResponse'];
type VaultPageRestore = components['schemas']['PageRestoreResponse'];

function materializeVaultPageSaveRequest(
  input: VaultPageSaveInput,
): VaultPageSaveRequest {
  return { force: false, is_database: false, metadata: {}, ...input };
}

function materializeVaultPagePatchRequest(
  input: VaultPagePatchInput,
): VaultPagePatchRequest {
  return { force: false, ...input };
}

async function invalidateSidebarAfter<T>(request: Promise<T>): Promise<T> {
  const result = await request;
  await invalidateCachedQuery(bootstrapQueryKeys.vaultSidebar());
  return result;
}

export async function createVaultPage(
  input: VaultPageSaveInput,
): Promise<VaultPageMutation> {
  return invalidateSidebarAfter(
    apiClient
      .POST('/api/vault/pages', { body: materializeVaultPageSaveRequest(input) })
      .then((result) => unwrapApiResult<VaultPageMutation, unknown>(result)),
  );
}

export async function saveVaultPage(
  pageId: string,
  input: VaultPageSaveInput,
): Promise<VaultPageMutation> {
  return invalidateSidebarAfter(
    apiClient
      .PUT('/api/vault/pages/{page_id}', {
        body: materializeVaultPageSaveRequest(input),
        params: { path: { page_id: pageId } },
      })
      .then((result) => unwrapApiResult<VaultPageMutation, unknown>(result)),
  );
}

export async function patchVaultPage(
  pageId: string,
  input: VaultPagePatchInput,
): Promise<VaultPageMutation> {
  return invalidateSidebarAfter(
    apiClient
      .PATCH('/api/vault/pages/{page_id}', {
        body: materializeVaultPagePatchRequest(input),
        params: { path: { page_id: pageId } },
      })
      .then((result) => unwrapApiResult<VaultPageMutation, unknown>(result)),
  );
}

export async function deleteVaultPage(
  pageId: string,
): Promise<VaultPageDeletion> {
  return invalidateSidebarAfter(
    apiClient
      .DELETE('/api/vault/pages/{page_id}', {
        params: { path: { page_id: pageId } },
      })
      .then((result) => unwrapApiResult<VaultPageDeletion, unknown>(result)),
  );
}

export async function duplicateVaultPage(
  pageId: string,
): Promise<VaultPageDuplicate> {
  return invalidateSidebarAfter(
    apiClient
      .POST('/api/vault/pages/{page_id}/duplicate', {
        params: { path: { page_id: pageId } },
      })
      .then((result) => unwrapApiResult<VaultPageDuplicate, unknown>(result)),
  );
}

export async function bulkApplyVaultTemplate(
  input: VaultBulkTemplateInput,
): Promise<VaultBulkTemplateResult> {
  return invalidateSidebarAfter(
    apiClient
      .POST('/api/vault/bulk-apply-template', { body: input })
      .then((result) => unwrapApiResult<VaultBulkTemplateResult, unknown>(result)),
  );
}

export async function restoreVaultPage(
  pageId: string,
): Promise<VaultPageRestore> {
  return invalidateSidebarAfter(
    apiClient
      .POST('/api/vault/pages/{page_id}/restore', {
        params: { path: { page_id: pageId } },
      })
      .then((result) => unwrapApiResult<VaultPageRestore, unknown>(result)),
  );
}
