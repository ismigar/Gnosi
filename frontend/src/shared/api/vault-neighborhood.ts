import { apiClient } from './client';
import { unwrapApiResult } from './errors';
import { requestContextHeaders, type RequestContext } from './request-context';

export async function fetchVaultLinkNeighborhood(pageId: string, signal: AbortSignal, scope: RequestContext) {
  return unwrapApiResult(await apiClient.GET('/api/vault/link-neighborhood', {
    params: { query: { page_id: pageId } },
    headers: requestContextHeaders(scope),
    signal,
  }));
}
