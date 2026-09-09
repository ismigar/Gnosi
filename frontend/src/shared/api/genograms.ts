import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';
import { currentRequestContext } from './request-context';
export { currentRequestContext as genogramRequestContext };
export async function prepareGenograms(locale: 'ca' | 'en' | 'es' | 'fr') {
  return unwrapApiResult(await apiClient.POST('/api/vault/genograms/prepare', { body: { locale } }));
}
export async function fetchGenogram(body: components['schemas']['GenogramGraphRequest'], signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.POST('/api/vault/genograms/graph', { body, signal }));
}
