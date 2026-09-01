import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type LinkPreview = components['schemas']['LinkPreviewResponse'];


export async function fetchLinkPreview(
  url: string,
  signal?: AbortSignal,
): Promise<LinkPreview> {
  return unwrapApiResult<LinkPreview, unknown>(
    await apiClient.GET('/api/vault/link-preview', {
      params: { query: { url } },
      signal,
    }),
  );
}
