import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type BrainSuggestion = components['schemas']['BrainSuggestionResponse'];
export type BrainSuggestionList =
  components['schemas']['BrainSuggestionListResponse'];
export type BrainSuggestionRejection =
  components['schemas']['BrainSuggestionRejectedResponse'];


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
