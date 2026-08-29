import type { components, paths } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


type TranslateRowOpenApiBody =
  paths['/api/vault/skills/translate-row']['post']['requestBody']['content']['application/json'];
type TranslateRowsOpenApiBody =
  paths['/api/vault/skills/translate-rows']['post']['requestBody']['content']['application/json'];
type TranslatePageOpenApiBody =
  paths['/api/vault/skills/translate-page']['post']['requestBody']['content']['application/json'];
type SyncDrupalRowOpenApiBody =
  paths['/api/vault/skills/sync-drupal-row']['post']['requestBody']['content']['application/json'];

export type TranslateRowResult =
  components['schemas']['TranslateRowResponse'];
export type TranslateRowsResult =
  components['schemas']['TranslateRowsResponse'];
export type TranslatePageResult =
  components['schemas']['TranslatePageResponse'];
export type SyncDrupalRowResult =
  components['schemas']['SyncDrupalRowResponse'];
export type SyncDrupalScope = SyncDrupalRowResult['scope'];

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

export type SyncDrupalRowInput = SyncDrupalRowOpenApiBody & {
  button_action: 'sync_drupal';
  item_id: string;
  push_media: boolean;
  scope: SyncDrupalScope;
};

export const DRUPAL_SYNC_TIMEOUT_MS = 180_000;


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


function drupalSyncSignal(signal?: AbortSignal): {
  readonly cleanup: () => void;
  readonly didTimeout: () => boolean;
  readonly signal: AbortSignal;
} {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => {
    controller.abort(signal?.reason);
  };

  if (signal?.aborted) {
    abortFromCaller();
  } else {
    signal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(
      new Error(`timeout of ${String(DRUPAL_SYNC_TIMEOUT_MS)}ms exceeded`),
    );
  }, DRUPAL_SYNC_TIMEOUT_MS);

  return {
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    },
    didTimeout: () => timedOut,
    signal: controller.signal,
  };
}


export async function syncDrupalRow(
  payload: SyncDrupalRowInput,
  signal?: AbortSignal,
): Promise<SyncDrupalRowResult> {
  const timedSignal = drupalSyncSignal(signal);
  const timeoutMessage =
    `timeout of ${String(DRUPAL_SYNC_TIMEOUT_MS)}ms exceeded`;

  try {
    return unwrapApiResult<SyncDrupalRowResult, unknown>(
      await apiClient.POST('/api/vault/skills/sync-drupal-row', {
        body: payload,
        signal: timedSignal.signal,
      }),
    );
  } catch (error) {
    if (timedSignal.didTimeout() && (
      !(error instanceof Error) || error.message !== timeoutMessage
    )) {
      throw new Error(timeoutMessage, { cause: error });
    }
    throw error;
  } finally {
    timedSignal.cleanup();
  }
}
