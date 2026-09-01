import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { assertApiSuccess, unwrapApiResult } from './errors';


export type NotebookSummary = components['schemas']['NotebookSummaryResponse'];
export type NotebookDetail = components['schemas']['NotebookDetailResponse'];
export type NotebookPage = components['schemas']['NotebookPageResponse'];
type GeneratedNotebookCreateInput = components['schemas']['NotebookCreateRequest'];
export type NotebookCreateInput = Pick<GeneratedNotebookCreateInput, 'resource_ids'> &
  Partial<Omit<GeneratedNotebookCreateInput, 'resource_ids'>>;
export type NotebookUpdateInput = components['schemas']['NotebookPatchRequest'];
export type ReferenceResource = components['schemas']['ReferenceResourceResponse'];
export type ReferenceResourcePage =
  components['schemas']['ReferenceResourcePageResponse'];
export type NotebookSourcesPage =
  components['schemas']['NotebookSourcesPageResponse'];
export type NotebookChatSources =
  components['schemas']['NotebookChatSourcesResponse'];
export type NotebookRefresh = components['schemas']['NotebookRefreshResponse'];
export type NotebookSearch = components['schemas']['NotebookSearchResponse'];
export type NotebookEvidence = components['schemas']['NotebookEvidenceResponse'];
export type NotebookConversation =
  components['schemas']['NotebookConversationResponse'];


export interface NotebookListQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly query?: string;
}


export interface ReferenceResourceQuery extends NotebookListQuery {
  readonly author?: string;
  readonly notebookId?: string;
  readonly resourceType?: string;
  readonly tag?: string;
}


export interface NotebookSourcesQuery {
  readonly page?: number;
  readonly pageSize?: number;
}


export async function fetchNotebooks(
  query: NotebookListQuery = {},
  signal?: AbortSignal,
): Promise<NotebookPage> {
  return unwrapApiResult<NotebookPage, unknown>(
    await apiClient.GET('/api/notebooks', {
      params: {
        query: {
          page: query.page,
          page_size: query.pageSize,
          q: query.query,
        },
      },
      signal,
    }),
  );
}


export async function createNotebook(input: NotebookCreateInput): Promise<NotebookDetail> {
  return unwrapApiResult<NotebookDetail, unknown>(
    await apiClient.POST('/api/notebooks', {
      body: {
        conversation_mode: 'private_member',
        title: 'Untitled notebook',
        visibility: 'private',
        ...input,
      },
    }),
  );
}


export async function fetchReferenceResources(
  query: ReferenceResourceQuery = {},
  signal?: AbortSignal,
): Promise<ReferenceResourcePage> {
  return unwrapApiResult<ReferenceResourcePage, unknown>(
    await apiClient.GET('/api/notebooks/resources', {
      params: {
        query: {
          author: query.author,
          notebook_id: query.notebookId,
          page: query.page,
          page_size: query.pageSize,
          q: query.query,
          tag: query.tag,
          type: query.resourceType,
        },
      },
      signal,
    }),
  );
}


export async function fetchNotebook(
  notebookId: string,
  refresh = true,
): Promise<NotebookDetail> {
  return unwrapApiResult<NotebookDetail, unknown>(
    await apiClient.GET('/api/notebooks/{notebook_id}', {
      params: {
        path: { notebook_id: notebookId },
        query: { refresh },
      },
    }),
  );
}


export async function updateNotebook(
  notebookId: string,
  update: NotebookUpdateInput,
): Promise<NotebookDetail> {
  return unwrapApiResult<NotebookDetail, unknown>(
    await apiClient.PATCH('/api/notebooks/{notebook_id}', {
      body: update,
      params: { path: { notebook_id: notebookId } },
    }),
  );
}


export async function deleteNotebook(notebookId: string): Promise<void> {
  assertApiSuccess(
    await apiClient.DELETE('/api/notebooks/{notebook_id}', {
      params: { path: { notebook_id: notebookId } },
    }),
  );
}


export async function fetchNotebookSources(
  notebookId: string,
  query: NotebookSourcesQuery = {},
): Promise<NotebookSourcesPage> {
  return unwrapApiResult<NotebookSourcesPage, unknown>(
    await apiClient.GET('/api/notebooks/{notebook_id}/sources', {
      params: {
        path: { notebook_id: notebookId },
        query: { page: query.page, page_size: query.pageSize },
      },
    }),
  );
}


export async function fetchNotebookChatSources(
  notebookId: string,
  signal?: AbortSignal,
): Promise<NotebookChatSources> {
  return unwrapApiResult<NotebookChatSources, unknown>(
    await apiClient.GET('/api/notebooks/{notebook_id}/chat-sources', {
      params: { path: { notebook_id: notebookId } },
      signal,
    }),
  );
}


export async function addNotebookSources(
  notebookId: string,
  resourceIds: string[],
): Promise<NotebookDetail> {
  return unwrapApiResult<NotebookDetail, unknown>(
    await apiClient.POST('/api/notebooks/{notebook_id}/sources', {
      body: { resource_ids: resourceIds },
      params: { path: { notebook_id: notebookId } },
    }),
  );
}


export async function removeNotebookSource(
  notebookId: string,
  resourceId: string,
): Promise<NotebookDetail> {
  return unwrapApiResult<NotebookDetail, unknown>(
    await apiClient.DELETE('/api/notebooks/{notebook_id}/sources/{resource_id}', {
      params: { path: { notebook_id: notebookId, resource_id: resourceId } },
    }),
  );
}


export async function refreshNotebook(
  notebookId: string,
  reason = 'manual',
): Promise<NotebookRefresh> {
  return unwrapApiResult<NotebookRefresh, unknown>(
    await apiClient.POST('/api/notebooks/{notebook_id}/refresh', {
      body: { force: true, reason },
      params: { path: { notebook_id: notebookId } },
    }),
  );
}


export async function refreshNotebookSource(
  notebookId: string,
  resourceId: string,
): Promise<NotebookRefresh> {
  return unwrapApiResult<NotebookRefresh, unknown>(
    await apiClient.POST('/api/notebooks/{notebook_id}/sources/{resource_id}/refresh', {
      body: { force: true, reason: 'resource_retry' },
      params: { path: { notebook_id: notebookId, resource_id: resourceId } },
    }),
  );
}


export async function cancelNotebookRefresh(notebookId: string): Promise<NotebookDetail> {
  return unwrapApiResult<NotebookDetail, unknown>(
    await apiClient.POST('/api/notebooks/{notebook_id}/refresh/cancel', {
      params: { path: { notebook_id: notebookId } },
    }),
  );
}


export async function searchNotebook(
  notebookId: string,
  query: string,
  limit = 12,
): Promise<NotebookSearch> {
  return unwrapApiResult<NotebookSearch, unknown>(
    await apiClient.GET('/api/notebooks/{notebook_id}/search', {
      params: {
        path: { notebook_id: notebookId },
        query: { limit, q: query },
      },
    }),
  );
}


export async function fetchNotebookEvidence(
  notebookId: string,
  chunkId: string,
  revision?: number,
): Promise<NotebookEvidence> {
  return unwrapApiResult<NotebookEvidence, unknown>(
    await apiClient.GET('/api/notebooks/{notebook_id}/evidence/{chunk_id}', {
      params: {
        path: { chunk_id: chunkId, notebook_id: notebookId },
        query: { revision },
      },
    }),
  );
}


export async function fetchNotebookConversation(
  notebookId: string,
): Promise<NotebookConversation> {
  return unwrapApiResult<NotebookConversation, unknown>(
    await apiClient.GET('/api/notebooks/{notebook_id}/conversation', {
      params: { path: { notebook_id: notebookId } },
    }),
  );
}
