import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';

export type ModelTiersConfig = components['schemas']['ModelTiersConfig'];
export type ModelTierRoute = components['schemas']['ModelTierRoute'];

export async function fetchAiModelTiers(signal?: AbortSignal): Promise<ModelTiersConfig> {
  return unwrapApiResult<ModelTiersConfig, unknown>(await apiClient.GET('/api/ai/model-tiers', { signal }));
}

export async function saveAiModelTiers(body: ModelTiersConfig): Promise<ModelTiersConfig> {
  return unwrapApiResult<ModelTiersConfig, unknown>(await apiClient.PUT('/api/ai/model-tiers', { body }));
}
