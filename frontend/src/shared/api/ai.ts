import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';

export type AiCatalog = components['schemas']['AiCatalogResponse'];
export type AiModelCatalog = components['schemas']['ModelCatalogResponse'];
export type AiModelComparison =
  components['schemas']['ModelComparisonResponse'];
export type AiModelRegistry = components['schemas']['ModelRegistryResponse'];
export type AiModelsPayload = components['schemas']['ModelsPayload'];
export type AiModelRegistryUpdate =
  components['schemas']['ModelRegistryUpdateResponse'];
export type AiModelReliability =
  components['schemas']['ModelReliabilityResponse'];
export type AiUsage = components['schemas']['AiUsageResponse'];
export type AiUsageHistory = components['schemas']['AiUsageHistoryResponse'];
export type AiGenerateInput = components['schemas']['GeneratePayload'];
export type AiGenerateResult = components['schemas']['GenerateContentResponse'];
export type AiCorrectionInput = components['schemas']['CorrectPayload'];
export type AiCorrectionResult = components['schemas']['CorrectTextResponse'];


export async function generateAiContent(
  payload: AiGenerateInput,
  signal?: AbortSignal,
): Promise<AiGenerateResult> {
  return unwrapApiResult<AiGenerateResult, unknown>(
    await apiClient.POST('/api/ai/generate', { body: payload, signal }),
  );
}


export async function correctAiContent(
  payload: AiCorrectionInput,
  signal?: AbortSignal,
): Promise<AiCorrectionResult> {
  return unwrapApiResult<AiCorrectionResult, unknown>(
    await apiClient.POST('/api/ai/correct', { body: payload, signal }),
  );
}

export async function fetchAiCatalog(
  signal?: AbortSignal,
): Promise<AiCatalog> {
  return unwrapApiResult<AiCatalog, unknown>(
    await apiClient.GET('/api/ai/catalog', { signal }),
  );
}

export async function fetchAiModels(
  signal?: AbortSignal,
): Promise<AiModelRegistry> {
  return unwrapApiResult<AiModelRegistry, unknown>(
    await apiClient.GET('/api/ai/models', { signal }),
  );
}

export async function updateAiModels(
  payload: AiModelsPayload,
  signal?: AbortSignal,
): Promise<AiModelRegistryUpdate> {
  return unwrapApiResult<AiModelRegistryUpdate, unknown>(
    await apiClient.PUT('/api/ai/models', { body: payload, signal }),
  );
}

export async function fetchAiModelCatalog(
  refresh?: boolean,
  signal?: AbortSignal,
): Promise<AiModelCatalog> {
  return unwrapApiResult<AiModelCatalog, unknown>(
    await apiClient.GET('/api/ai/model-catalog', {
      params: { query: { refresh } },
      signal,
    }),
  );
}

export async function fetchAiModelComparison(
  signal?: AbortSignal,
): Promise<AiModelComparison> {
  return unwrapApiResult<AiModelComparison, unknown>(
    await apiClient.GET('/api/ai/model-comparison', { signal }),
  );
}


export async function fetchAiModelReliability(
  windowDays = 30,
  signal?: AbortSignal,
): Promise<AiModelReliability> {
  return unwrapApiResult<AiModelReliability, unknown>(
    await apiClient.GET('/api/ai/model-reliability', {
      params: { query: { window_days: windowDays } },
      signal,
    }),
  );
}

export async function fetchAiUsage(
  signal?: AbortSignal,
): Promise<AiUsage> {
  return unwrapApiResult<AiUsage, unknown>(
    await apiClient.GET('/api/ai/usage', { signal }),
  );
}

export async function fetchAiUsageHistory(
  signal?: AbortSignal,
): Promise<AiUsageHistory> {
  return unwrapApiResult<AiUsageHistory, unknown>(
    await apiClient.GET('/api/ai/usage/history', { signal }),
  );
}
