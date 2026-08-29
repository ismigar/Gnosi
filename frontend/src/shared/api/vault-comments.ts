import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type VaultPageComment = components['schemas']['PageComment'];
export type VaultPageCommentThread = components['schemas']['PageCommentThread'];
export type VaultPageCommentInput = components['schemas']['CommentCreateRequest'];
export type VaultPageCommentPatch = components['schemas']['CommentUpdateRequest'];
export type VaultInlineComment = components['schemas']['InlineComment'];
type VaultInlineCommentRequest = components['schemas']['InlineCommentRequest'];
export type VaultInlineCommentInput = Omit<VaultInlineCommentRequest, 'quote'> &
  Partial<Pick<VaultInlineCommentRequest, 'quote'>>;
export type VaultInlineCommentPatch =
  components['schemas']['InlineCommentPatch'];
export type VaultCommentDeletion =
  components['schemas']['CommentDeleteResponse'];


export async function fetchVaultPageComments(
  pageId: string,
  signal?: AbortSignal,
): Promise<VaultPageCommentThread> {
  return unwrapApiResult<VaultPageCommentThread, unknown>(
    await apiClient.GET('/api/vault/pages/{page_id}/comments', {
      params: { path: { page_id: pageId } },
      signal,
    }),
  );
}


export async function createVaultPageComment(
  pageId: string,
  input: VaultPageCommentInput,
): Promise<VaultPageComment> {
  return unwrapApiResult<VaultPageComment, unknown>(
    await apiClient.POST('/api/vault/pages/{page_id}/comments', {
      body: input,
      params: { path: { page_id: pageId } },
    }),
  );
}


export async function updateVaultPageComment(
  pageId: string,
  commentId: string,
  input: VaultPageCommentPatch,
): Promise<VaultPageComment> {
  return unwrapApiResult<VaultPageComment, unknown>(
    await apiClient.PATCH('/api/vault/pages/{page_id}/comments/{comment_id}', {
      body: input,
      params: { path: { comment_id: commentId, page_id: pageId } },
    }),
  );
}


export async function deleteVaultPageComment(
  pageId: string,
  commentId: string,
): Promise<VaultCommentDeletion> {
  return unwrapApiResult<VaultCommentDeletion, unknown>(
    await apiClient.DELETE('/api/vault/pages/{page_id}/comments/{comment_id}', {
      params: { path: { comment_id: commentId, page_id: pageId } },
    }),
  );
}


export async function fetchVaultInlineComments(
  pageId: string,
  signal?: AbortSignal,
): Promise<VaultInlineComment[]> {
  return unwrapApiResult<VaultInlineComment[], unknown>(
    await apiClient.GET('/api/vault/pages/{page_id}/inline-comments', {
      params: { path: { page_id: pageId } },
      signal,
    }),
  );
}


export async function createVaultInlineComment(
  pageId: string,
  input: VaultInlineCommentInput,
): Promise<VaultInlineComment> {
  return unwrapApiResult<VaultInlineComment, unknown>(
    await apiClient.POST('/api/vault/pages/{page_id}/inline-comments', {
      body: { quote: '', ...input },
      params: { path: { page_id: pageId } },
    }),
  );
}


export async function updateVaultInlineComment(
  pageId: string,
  commentId: string,
  input: VaultInlineCommentPatch,
): Promise<VaultInlineComment> {
  return unwrapApiResult<VaultInlineComment, unknown>(
    await apiClient.PATCH(
      '/api/vault/pages/{page_id}/inline-comments/{comment_id}',
      {
        body: input,
        params: { path: { comment_id: commentId, page_id: pageId } },
      },
    ),
  );
}


export async function deleteVaultInlineComment(
  pageId: string,
  commentId: string,
): Promise<VaultCommentDeletion> {
  return unwrapApiResult<VaultCommentDeletion, unknown>(
    await apiClient.DELETE(
      '/api/vault/pages/{page_id}/inline-comments/{comment_id}',
      { params: { path: { comment_id: commentId, page_id: pageId } } },
    ),
  );
}
