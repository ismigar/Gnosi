import type { components } from '../../generated/openapi';
import { bootstrapQueryKeys } from './bootstrap-query-keys';
import { fetchCachedQuery, invalidateCachedQuery } from './cached-query';
import { apiClient } from './client';
import type { ApiResult } from './errors';


type LlmWikiConfiguration = components['schemas']['LlmWikiConfigResponse'];


export function fetchLlmWikiConfigResult(
  signal?: AbortSignal,
): Promise<ApiResult<LlmWikiConfiguration>> {
  return fetchCachedQuery({
    queryFn: (sharedSignal) => apiClient.GET('/api/vault/llm-wiki/config', {
      signal: sharedSignal,
    }),
    queryKey: bootstrapQueryKeys.llmWikiConfig(),
    signal,
  });
}


export async function invalidateLlmWikiConfig(): Promise<void> {
  await invalidateCachedQuery(bootstrapQueryKeys.llmWikiConfig());
}
