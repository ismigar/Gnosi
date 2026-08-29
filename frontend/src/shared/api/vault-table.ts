import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


type PageMutationResponse = components['schemas']['PageMutationResponse'];
type PagePatchRequest = components['schemas']['PagePatchRequest'];
type PageSaveRequest = components['schemas']['PageSaveRequest'];
type JsonRecord = Record<string, unknown>;


export interface VaultTablePageCreateInput {
  content: string;
  metadata: JsonRecord;
  parent_id?: string;
  title: string;
}


export interface VaultTablePagePatchInput {
  metadata: JsonRecord;
}


export interface VaultTableButtonActionInput extends JsonRecord {
  button_action: 'ai_prompt' | 'run_skill';
  button_config: JsonRecord;
  note_id: string;
}


export interface VaultTableButtonActionResponse extends JsonRecord {
  status: string;
}


function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}


export async function createVaultTablePage(
  input: VaultTablePageCreateInput,
  signal?: AbortSignal,
): Promise<PageMutationResponse> {
  return unwrapApiResult<PageMutationResponse, unknown>(
    await apiClient.POST('/api/vault/pages', {
      // PageSaveRequest has backend defaults represented as required by OpenAPI.
      // VaultTable intentionally preserves its historical wire payload here.
      body: input as PageSaveRequest,
      signal,
    }),
  );
}


export async function patchVaultTablePage(
  pageId: string,
  input: VaultTablePagePatchInput,
  signal?: AbortSignal,
): Promise<PageMutationResponse> {
  return unwrapApiResult<PageMutationResponse, unknown>(
    await apiClient.PATCH('/api/vault/pages/{page_id}', {
      // The shared ETag middleware adds expected_etag only when one is cached.
      body: input as PagePatchRequest,
      params: { path: { page_id: pageId } },
      signal,
    }),
  );
}


export async function executeVaultTableButtonAction(
  input: VaultTableButtonActionInput,
  signal?: AbortSignal,
): Promise<VaultTableButtonActionResponse> {
  const payload = unwrapApiResult<unknown, unknown>(
    await apiClient.POST('/api/vault/skills/execute-button-action', {
      body: input,
      signal,
    }),
  );
  if (!isJsonRecord(payload) || typeof payload.status !== 'string') {
    throw new TypeError('The Vault table button action returned an invalid response');
  }
  return { ...payload, status: payload.status };
}
