import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


type GeneratedResourceProcessingInput =
  components['schemas']['LlmWikiProcessRequest'];
export type ResourceProcessingInput = Partial<GeneratedResourceProcessingInput>;
export type ResourceProcessingJob =
  components['schemas']['LlmWikiJobResponse'];
export type ResourceProcessingStart =
  components['schemas']['LlmWikiProcessStartResponse'];


export async function startResourceProcessing(
  input: ResourceProcessingInput,
  signal?: AbortSignal,
): Promise<ResourceProcessingStart> {
  return unwrapApiResult<ResourceProcessingStart, unknown>(
    await apiClient.POST('/api/vault/llm-wiki/process', {
      body: input as GeneratedResourceProcessingInput,
      signal,
    }),
  );
}


export async function fetchResourceProcessingStatus(
  itemId: string,
  sourceTableId = '',
  signal?: AbortSignal,
): Promise<ResourceProcessingJob> {
  return unwrapApiResult<ResourceProcessingJob, unknown>(
    await apiClient.GET('/api/vault/llm-wiki/status/{item_id}', {
      params: {
        path: { item_id: itemId },
        query: sourceTableId
          ? { source_table_id: sourceTableId }
          : {},
      },
      signal,
    }),
  );
}
