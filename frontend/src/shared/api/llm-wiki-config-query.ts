import type { components } from '../../generated/openapi';
import { bootstrapQueryKeys } from './bootstrap-query-keys';
import { fetchCachedQuery, invalidateCachedQuery } from './cached-query';
import { apiClient } from './client';
import { unwrapApiResult, type ApiResult } from './errors';


type LlmWikiConfiguration = components['schemas']['LlmWikiConfigResponse'];


export function fetchLlmWikiConfigResult(
  signal?: AbortSignal,
): Promise<ApiResult<LlmWikiConfiguration>> {
  return fetchCachedQuery({
    queryFn: async (sharedSignal) => {
      const result = await apiClient.GET('/api/vault/llm-wiki/config', {
        signal: sharedSignal,
      });
      // Reject failures before caching, so retries reach the recovered server.
      unwrapApiResult(result);
      return result;
    },
    queryKey: bootstrapQueryKeys.llmWikiConfig(),
    signal,
  });
}


export async function invalidateLlmWikiConfig(): Promise<void> {
  await invalidateCachedQuery(bootstrapQueryKeys.llmWikiConfig());
}
