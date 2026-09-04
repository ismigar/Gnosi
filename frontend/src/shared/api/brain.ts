import type { components } from '../../generated/openapi';
import { bootstrapQueryKeys } from './bootstrap-query-keys';
import { fetchCachedQuery, invalidateCachedQuery } from './cached-query';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';
import {
  fetchLlmWikiConfigResult,
  invalidateLlmWikiConfig,
} from './llm-wiki-config-query';


export type BrainSuggestion = components['schemas']['BrainSuggestionResponse'];
export type BrainSuggestionList =
  components['schemas']['BrainSuggestionListResponse'];
export type BrainSuggestionRejection =
  components['schemas']['BrainSuggestionRejectedResponse'];
export type BrainTableStatus = components['schemas']['BrainTableStatusResponse'];
export type LlmWikiConfiguration = components['schemas']['LlmWikiConfigResponse'];


export async function fetchBrainTableStatus(
  signal?: AbortSignal,
): Promise<BrainTableStatus> {
  return fetchCachedQuery({
    queryFn: async (sharedSignal) => unwrapApiResult<BrainTableStatus, unknown>(
      await apiClient.GET('/api/vault/brain-table', { signal: sharedSignal }),
    ),
    queryKey: bootstrapQueryKeys.brainTable(),
    signal,
  });
}

export async function invalidateBrainTableStatus(): Promise<void> {
  await invalidateCachedQuery(bootstrapQueryKeys.brainTable());
}


export async function fetchLlmWikiConfig(
  signal?: AbortSignal,
): Promise<LlmWikiConfiguration> {
  return unwrapApiResult<LlmWikiConfiguration, unknown>(
    await fetchLlmWikiConfigResult(signal),
  );
}


export { invalidateLlmWikiConfig };


export async function fetchBrainSuggestions(
  signal?: AbortSignal,
): Promise<BrainSuggestionList> {
  return unwrapApiResult<BrainSuggestionList, unknown>(
    await apiClient.GET('/api/vault/llm-wiki/suggestions', { signal }),
  );
}


export async function dismissBrainSuggestion(
  suggestionId: string,
  signal?: AbortSignal,
): Promise<BrainSuggestionRejection> {
  return unwrapApiResult<BrainSuggestionRejection, unknown>(
    await apiClient.POST(
      '/api/vault/llm-wiki/suggestions/{suggestion_id}/dismiss',
      {
        params: { path: { suggestion_id: suggestionId } },
        signal,
      },
    ),
  );
}
