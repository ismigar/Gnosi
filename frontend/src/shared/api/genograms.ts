import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';
import { currentRequestContext } from './request-context';
export { currentRequestContext as genogramRequestContext };
export async function fetchGenogramSetupStatus(vaultId: string, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.GET('/api/vault/genograms/status', {
    headers: { 'X-Vault-ID': vaultId }, signal,
  }));
}
export async function prepareGenograms(locale: 'ca' | 'en' | 'es' | 'fr', vaultId?: string) {
  return unwrapApiResult(await apiClient.POST('/api/vault/genograms/prepare', {
    body: { locale }, headers: vaultId ? { 'X-Vault-ID': vaultId } : undefined,
  }));
}
export async function fetchGenogram(body: components['schemas']['GenogramGraphRequest'], signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.POST('/api/vault/genograms/graph', { body, signal }));
}
