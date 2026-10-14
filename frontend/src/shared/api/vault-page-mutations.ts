import type { components } from '../../generated/openapi';
import { emitAppEvent } from '../platform/app-events';
import { bootstrapQueryKeys } from './bootstrap-query-keys';
import { invalidateCachedQuery } from './cached-query';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';
import { queuePageWrite } from './page-write-queue';
import { currentRequestContext, type RequestContext } from './request-context';
import { createRecoverablePage } from './page-creation-recovery';

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

async function invalidateSidebarAfter<T>(
  request: Promise<T>, refreshContent: boolean | ((result: T) => boolean) = true,
): Promise<T> {
  const result = await request;
  const changed = typeof refreshContent === 'function' ? refreshContent(result) : refreshContent;
  if (changed) emitAppEvent('gnosi:invalidatePreview', {});
  await invalidateCachedQuery(bootstrapQueryKeys.vaultSidebar());
  return result;
}

export async function createVaultPage(
  input: VaultPageSaveInput,
): Promise<VaultPageMutation> {
  return invalidateSidebarAfter(
    createRecoverablePage(materializeVaultPageSaveRequest(input)),
    false,
  );
}

export async function saveVaultPage(
  pageId: string,
  input: VaultPageSaveInput,
): Promise<VaultPageMutation> {
  return queuePageWrite(pageId, () => invalidateSidebarAfter(
    apiClient
      .PUT('/api/vault/pages/{page_id}', {
        body: materializeVaultPageSaveRequest(input),
        params: { path: { page_id: pageId } },
      })
      .then((result) => unwrapApiResult<VaultPageMutation, unknown>(result)),
    false,
  ));
}

export interface PageMutationOptions {
  readonly context?: RequestContext;
  readonly signal?: AbortSignal;
}

export async function patchVaultPage(
  pageId: string,
  input: VaultPagePatchInput,
  options: PageMutationOptions = {},
): Promise<VaultPageMutation> {
  const context = options.context ? { ...options.context } : undefined;
  const { signal } = options;
  return queuePageWrite(pageId, () => {
    signal?.throwIfAborted();
    const current = currentRequestContext();
    if (context && (context.userId !== current.userId || context.userEmail !== current.userEmail
      || context.workspaceId !== current.workspaceId || context.vaultId !== current.vaultId)) {
      throw new DOMException('Page write context changed before dispatch', 'AbortError');
    }
    return invalidateSidebarAfter(
      apiClient
        .PATCH('/api/vault/pages/{page_id}', {
          body: materializeVaultPagePatchRequest(input),
          params: { path: { page_id: pageId } },
          signal,
          headers: context ? {
            'X-Vault-ID': context.vaultId,
            'X-Workspace-ID': context.workspaceId,
            'X-User-ID': context.userId,
            'X-User-Email': context.userEmail,
            'X-Gnosi-Expected-User-ID': context.userId,
          } : undefined,
        })
        .then((result) => unwrapApiResult<VaultPageMutation, unknown>(result)),
      false,
    );
  });
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
    result => result.updated > 0,
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
