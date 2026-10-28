import type { components, paths } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


type TranslateRowOpenApiBody =
  paths['/api/vault/skills/translate-row']['post']['requestBody']['content']['application/json'];
type TranslateRowsOpenApiBody =
  paths['/api/vault/skills/translate-rows']['post']['requestBody']['content']['application/json'];
type TranslatePageOpenApiBody =
  paths['/api/vault/skills/translate-page']['post']['requestBody']['content']['application/json'];

export type TranslateRowResult =
  components['schemas']['TranslateRowResponse'];
export type TranslateRowsResult =
  components['schemas']['TranslateRowsResponse'];
export type TranslatePageResult =
  components['schemas']['TranslatePageResponse'];

export type TranslateRowInput = TranslateRowOpenApiBody & {
  button_action: string;
  item_id: string;
  target_languages: string[];
};

export type TranslateRowsInput = TranslateRowsOpenApiBody & {
  button_action: 'translate_row';
  item_ids: string[];
  target_languages: string[];
};

export type TranslatePageInput = TranslatePageOpenApiBody & {
  button_action: 'translate_page';
  page_id: string;
  target_languages: string[];
};

export async function translateVaultRow(
  payload: TranslateRowInput,
  signal?: AbortSignal,
): Promise<TranslateRowResult> {
  return unwrapApiResult<TranslateRowResult, unknown>(
    await apiClient.POST('/api/vault/skills/translate-row', {
      body: payload,
      signal,
    }),
  );
}


export async function translateVaultRows(
  payload: TranslateRowsInput,
  signal?: AbortSignal,
): Promise<TranslateRowsResult> {
  return unwrapApiResult<TranslateRowsResult, unknown>(
    await apiClient.POST('/api/vault/skills/translate-rows', {
      body: payload,
      signal,
    }),
  );
}


export async function translateVaultPage(
  payload: TranslatePageInput,
  signal?: AbortSignal,
): Promise<TranslatePageResult> {
  return unwrapApiResult<TranslatePageResult, unknown>(
    await apiClient.POST('/api/vault/skills/translate-page', {
      body: payload,
      signal,
    }),
  );
}
