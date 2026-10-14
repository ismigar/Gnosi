import type { components } from '../../generated/openapi';
import { emitAppEvent } from '../platform/app-events';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';
import { queryClient } from './query-client';
import { currentRequestContext, type RequestContext } from './request-context';

export type ComposerRequest = components['schemas']['ComposerRequest'];
export type ComposerPreview = components['schemas']['ComposerPreview'];
export type ComposerResult = components['schemas']['ComposerResult'];

function headers(context: RequestContext) {
  return { 'X-Vault-ID': context.vaultId, 'X-Workspace-ID': context.workspaceId,
    'X-User-ID': context.userId, 'X-User-Email': context.userEmail };
}

function isCurrentContext(context: RequestContext): boolean {
  const current = currentRequestContext();
  return current.vaultId === context.vaultId && current.workspaceId === context.workspaceId
    && current.userId === context.userId && current.userEmail === context.userEmail;
}

export async function previewNoteComposition(request: ComposerRequest, context: RequestContext, signal?: AbortSignal): Promise<ComposerPreview> {
  return unwrapApiResult<ComposerPreview, unknown>(await apiClient.POST('/api/vault/composer/preview', {
    body: request, headers: headers(context), signal,
  }));
}

export async function applyNoteComposition(preview: ComposerPreview, context: RequestContext): Promise<ComposerResult> {
  if (!isCurrentContext(context)) throw new DOMException('Composer context changed before apply', 'AbortError');
  const result = unwrapApiResult<ComposerResult, unknown>(await apiClient.POST('/api/vault/composer/apply', {
    body: { request: preview.request, token: preview.token }, headers: headers(context),
  }));
  await queryClient.invalidateQueries({ queryKey: ['bootstrap', 'vault-sidebar', context.vaultId], exact: true, refetchType: 'none' });
  if (isCurrentContext(context)) {
    for (const change of result.changes) emitAppEvent('gnosi:invalidatePreview', { pageId: change.id });
  }
  return result;
}
