import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { GnosiApiError, unwrapApiResult } from './errors';


export type NotionCloneAbort = components['schemas']['NotionCloneAbortResponse'];
export type NotionCloneProgress = components['schemas']['NotionCloneProgressResponse'];
export type NotionCloneResult = components['schemas']['NotionCloneResponse'];
export type NotionDatabase = components['schemas']['NotionDatabaseResponse'];
export type NotionDatabaseSchema =
  components['schemas']['NotionDatabaseSchemaResponse'];
export type NotionDatabases = components['schemas']['NotionDatabasesResponse'];
export type NotionImportConfigResponse =
  components['schemas']['NotionImportConfigResponse'];
export type NotionLinkedDatabases =
  components['schemas']['NotionLinkedDatabasesResponse'];
export type NotionLoosePages = components['schemas']['NotionLoosePagesResponse'];
export type NotionMutation = components['schemas']['NotionMutationResponse'];
export type NotionOAuthStatus =
  components['schemas']['NotionOAuthStatusResponse'];
export type NotionStatus = components['schemas']['NotionStatusResponse'];
export type NotionTokenResult = components['schemas']['NotionTokenResponse'];
export type NotionVerification =
  components['schemas']['NotionVerificationResponse'];

export type NotionImportConfig = Record<string, unknown>;
export type NotionSchemaOverrides = Record<string, unknown>;
export type NotionLoosePageTypes = Record<string, unknown>;

export interface NotionCloneInput {
  readonly database_ids: string[] | null;
  readonly loose_page_types: NotionLoosePageTypes | null;
  readonly schema_overrides: NotionSchemaOverrides | null;
  readonly target_folder: string;
}

export interface NotionVerifyInput {
  readonly database_ids: string[] | null;
  readonly target_folder: string;
}

export interface NotionVaultRegistry {
  readonly tables?: readonly unknown[];
  readonly [key: string]: unknown;
}

export const NOTION_LIST_TIMEOUT_MS = 120_000;
export const NOTION_PROGRESS_TIMEOUT_MS = 8_000;


function timeoutSignal(
  timeoutMs: number,
  callerSignal?: AbortSignal,
): {
  readonly cleanup: () => void;
  readonly didTimeout: () => boolean;
  readonly signal: AbortSignal;
} {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => {
    controller.abort(callerSignal?.reason);
  };

  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`timeout of ${String(timeoutMs)}ms exceeded`));
  }, timeoutMs);

  return {
    cleanup: () => {
      globalThis.clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
    didTimeout: () => timedOut,
    signal: controller.signal,
  };
}


async function withTimeout<T>(
  timeoutMs: number,
  request: (signal: AbortSignal) => Promise<T>,
  callerSignal?: AbortSignal,
): Promise<T> {
  const timedSignal = timeoutSignal(timeoutMs, callerSignal);
  const timeoutMessage = `timeout of ${String(timeoutMs)}ms exceeded`;

  try {
    return await request(timedSignal.signal);
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


function isNotionVaultRegistry(value: unknown): value is NotionVaultRegistry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return !('tables' in value) || Array.isArray(value.tables);
}


export async function fetchNotionImportConfig(
  signal?: AbortSignal,
): Promise<NotionImportConfigResponse> {
  return unwrapApiResult<NotionImportConfigResponse, unknown>(
    await apiClient.GET('/api/notion/import-config', { signal }),
  );
}


export async function saveNotionImportConfig(
  config: NotionImportConfig,
  signal?: AbortSignal,
): Promise<NotionMutation> {
  return unwrapApiResult<NotionMutation, unknown>(
    await apiClient.PUT('/api/notion/import-config', {
      body: config,
      signal,
    }),
  );
}


export async function fetchNotionDatabaseSchema(
  databaseId: string,
  signal?: AbortSignal,
): Promise<NotionDatabaseSchema> {
  return unwrapApiResult<NotionDatabaseSchema, unknown>(
    await apiClient.GET('/api/notion/databases/{db_id}/schema', {
      params: { path: { db_id: databaseId } },
      signal,
    }),
  );
}


export async function fetchNotionStatus(
  signal?: AbortSignal,
): Promise<NotionStatus> {
  return unwrapApiResult<NotionStatus, unknown>(
    await apiClient.GET('/api/notion/status', { signal }),
  );
}


export async function fetchNotionOAuthStatus(
  signal?: AbortSignal,
): Promise<NotionOAuthStatus> {
  return unwrapApiResult<NotionOAuthStatus, unknown>(
    await apiClient.GET('/api/notion-oauth/status', { signal }),
  );
}


export async function connectNotionToken(
  token: string,
  signal?: AbortSignal,
): Promise<NotionTokenResult> {
  return unwrapApiResult<NotionTokenResult, unknown>(
    await apiClient.POST('/api/notion/token', {
      body: { token },
      signal,
    }),
  );
}


export async function disconnectNotionToken(
  signal?: AbortSignal,
): Promise<NotionMutation> {
  return unwrapApiResult<NotionMutation, unknown>(
    await apiClient.DELETE('/api/notion/token', { signal }),
  );
}


export async function fetchNotionLinkedDatabases(
  signal?: AbortSignal,
): Promise<NotionLinkedDatabases> {
  return unwrapApiResult<NotionLinkedDatabases, unknown>(
    await apiClient.GET('/api/notion/linked-databases', { signal }),
  );
}


export async function fetchNotionDatabases(
  signal?: AbortSignal,
): Promise<NotionDatabases> {
  return withTimeout(
    NOTION_LIST_TIMEOUT_MS,
    async (timedSignal) => unwrapApiResult<NotionDatabases, unknown>(
      await apiClient.GET('/api/notion/databases', { signal: timedSignal }),
    ),
    signal,
  );
}


export async function fetchNotionLoosePages(
  signal?: AbortSignal,
): Promise<NotionLoosePages> {
  return withTimeout(
    NOTION_LIST_TIMEOUT_MS,
    async (timedSignal) => unwrapApiResult<NotionLoosePages, unknown>(
      await apiClient.GET('/api/notion/loose-pages', { signal: timedSignal }),
    ),
    signal,
  );
}


export async function fetchNotionCloneProgress(
  signal?: AbortSignal,
): Promise<NotionCloneProgress> {
  return withTimeout(
    NOTION_PROGRESS_TIMEOUT_MS,
    async (timedSignal) => unwrapApiResult<NotionCloneProgress, unknown>(
      await apiClient.GET('/api/notion/clone/progress', { signal: timedSignal }),
    ),
    signal,
  );
}


export async function fetchNotionVaultRegistry(
  vaultId: string,
  signal?: AbortSignal,
): Promise<NotionVaultRegistry> {
  const result = await apiClient.GET('/api/vault/registry', {
    params: { header: { 'x-vault-id': vaultId } },
    signal,
  });
  const payload = unwrapApiResult<unknown, unknown>(result);
  if (!isNotionVaultRegistry(payload)) {
    throw new GnosiApiError(result.response, 'The API returned an invalid vault registry');
  }
  return payload;
}


export async function startNotionClone(
  input: NotionCloneInput,
  vaultId: string,
  signal?: AbortSignal,
): Promise<NotionCloneResult> {
  return unwrapApiResult<NotionCloneResult, unknown>(
    await apiClient.POST('/api/notion/clone', {
      // Pydantic defaults are intentionally omitted to preserve the historical body.
      body: input as components['schemas']['ClonePayload'],
      params: { header: { 'x-vault-id': vaultId } },
      signal,
    }),
  );
}


export async function abortNotionClone(
  signal?: AbortSignal,
): Promise<NotionCloneAbort> {
  return unwrapApiResult<NotionCloneAbort, unknown>(
    await apiClient.POST('/api/notion/clone/abort', { signal }),
  );
}


export async function verifyNotionClone(
  input: NotionVerifyInput,
  vaultId: string,
  signal?: AbortSignal,
): Promise<NotionVerification> {
  return unwrapApiResult<NotionVerification, unknown>(
    await apiClient.POST('/api/notion/verify-clone', {
      body: input,
      params: { header: { 'x-vault-id': vaultId } },
      signal,
    }),
  );
}
