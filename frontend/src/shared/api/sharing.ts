import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


type ShareCreateRequest = components['schemas']['ShareCreateRequest'];
export type ShareCreateInput = Omit<ShareCreateRequest, 'permission'> &
  Partial<Pick<ShareCreateRequest, 'permission'>>;
export type ShareLink = components['schemas']['ShareLinkResponse'];
export type ShareList = components['schemas']['ShareListResponse'];
export type ShareRevocation = components['schemas']['RevokedShareResponse'];
export type SharedPageDocument = components['schemas']['SharedPageResponse'];


export async function createShareLink(
  pageId: string,
  input: ShareCreateInput = {},
): Promise<ShareLink> {
  return unwrapApiResult<ShareLink, unknown>(
    await apiClient.POST('/api/vault/pages/{page_id}/share', {
      body: { permission: 'view', ...input },
      params: { path: { page_id: pageId } },
    }),
  );
}


export async function fetchShareLinks(
  pageId: string,
  signal?: AbortSignal,
): Promise<ShareList> {
  return unwrapApiResult<ShareList, unknown>(
    await apiClient.GET('/api/vault/pages/{page_id}/shares', {
      params: { path: { page_id: pageId } },
      signal,
    }),
  );
}


export async function revokeShareLink(token: string): Promise<ShareRevocation> {
  return unwrapApiResult<ShareRevocation, unknown>(
    await apiClient.DELETE('/api/vault/share/{token}', {
      params: { path: { token } },
    }),
  );
}


export async function fetchSharedPage(
  token: string,
  signal?: AbortSignal,
): Promise<SharedPageDocument> {
  return unwrapApiResult<SharedPageDocument, unknown>(
    await apiClient.GET('/api/share/{token}', {
      params: { path: { token } },
      signal,
    }),
  );
}
