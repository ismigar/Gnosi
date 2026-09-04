import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import {
  assertApiSuccess,
  GnosiApiError,
  type ApiResult,
} from './errors';
import {
  fetchLlmWikiConfigResult,
  invalidateLlmWikiConfig,
} from './llm-wiki-config-query';


type JsonRecord = Record<string, unknown>;

export type PluginLifecycleInput =
  components['schemas']['PluginLifecycleRequest'];
export type PluginTrustedKeyInput =
  components['schemas']['TrustedKeyRequest'];


export interface PluginState extends JsonRecord {
  readonly builtins?: readonly JsonRecord[];
  readonly disabled?: readonly string[];
  readonly enabled_builtin?: readonly string[];
  readonly enabled_third_party?: readonly string[];
  readonly granted?: Readonly<Record<string, unknown>>;
  readonly settings?: Readonly<Record<string, unknown>>;
}


export interface PluginPermissionsCatalog extends JsonRecord {
  readonly apiVersion: number;
  readonly permissions: Readonly<Record<string, string>>;
}


export interface PluginManifest extends JsonRecord {
  readonly author?: string | null;
  readonly description?: string | null;
  readonly id: string;
  readonly main?: string | null;
  readonly name?: string | null;
  readonly permissions?: readonly string[];
  readonly version?: string | null;
}


export interface InstalledPlugin extends JsonRecord {
  readonly enabled?: boolean | null;
  readonly error?: string | null;
  readonly granted?: readonly string[];
  readonly id?: string | null;
  readonly manifest?: PluginManifest | null;
  readonly provenance?: (JsonRecord & { readonly signedBy?: string }) | null;
}


export interface InstalledPluginsResponse extends JsonRecord {
  readonly plugins: readonly InstalledPlugin[];
}


export interface PluginCatalogEntry extends JsonRecord {
  readonly author?: string | null;
  readonly description?: string | null;
  readonly id: string;
  readonly installed: boolean;
  readonly name?: string | null;
  readonly signed: boolean;
  readonly source?: string | null;
  readonly version?: string | null;
}


export interface PluginCatalogResponse extends JsonRecord {
  readonly catalog: readonly PluginCatalogEntry[];
}


export interface PluginTrustedKey extends JsonRecord {
  readonly fingerprint: string;
  readonly name: string;
}


export interface PluginTrustedKeysResponse extends JsonRecord {
  readonly keys: readonly PluginTrustedKey[];
}


export interface PluginRegistryUrlResponse extends JsonRecord {
  readonly url: string;
}


export interface PluginLlmWikiSettingsDocument extends JsonRecord {
  readonly brain_roles?: Readonly<Record<string, unknown>>;
  readonly brain_table_id?: string;
  readonly configured?: boolean;
  readonly index_field_ids?: readonly string[];
  readonly source_tables?: readonly JsonRecord[];
  readonly target_table?: string;
  readonly ui_locale?: string | null;
  readonly version?: number | null;
}


export interface PluginLlmWikiSettingsResponse extends JsonRecord {
  readonly brain: JsonRecord & {
    readonly configured: boolean;
    readonly name: string | null;
    readonly table_id: string | null;
  };
  readonly capabilities: JsonRecord & {
    readonly ocr: boolean;
    readonly ocr_missing_languages: readonly string[];
    readonly streaming: boolean;
    readonly transcription: boolean;
  };
  readonly config: PluginLlmWikiSettingsDocument;
  readonly index_options: Readonly<
    Record<string, readonly { readonly label: string; readonly value: string }[]>
  >;
  readonly validation: JsonRecord & { readonly valid: boolean };
}


export interface PluginLlmWikiMaintenanceResponse extends JsonRecord {
  readonly lint: JsonRecord & {
    readonly counts: Readonly<Record<string, number>>;
    readonly note_count: number;
  };
  readonly suggestions_pending: number;
  readonly suggestions_queued: number;
}


function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}


function optionalStringArray(record: JsonRecord, key: string): boolean {
  return record[key] === undefined || isStringArray(record[key]);
}


function isPluginState(value: unknown): value is PluginState {
  if (!isRecord(value)) return false;
  return (
    optionalStringArray(value, 'disabled') &&
    optionalStringArray(value, 'enabled_builtin') &&
    optionalStringArray(value, 'enabled_third_party') &&
    (value.settings === undefined || isRecord(value.settings)) &&
    (value.granted === undefined || isRecord(value.granted)) &&
    (value.builtins === undefined || Array.isArray(value.builtins))
  );
}


function isPluginPermissionsCatalog(
  value: unknown,
): value is PluginPermissionsCatalog {
  return (
    isRecord(value) &&
    typeof value.apiVersion === 'number' &&
    isRecord(value.permissions) &&
    Object.values(value.permissions).every((item) => typeof item === 'string')
  );
}


function isInstalledPluginsResponse(
  value: unknown,
): value is InstalledPluginsResponse {
  return isRecord(value) && Array.isArray(value.plugins);
}


function isPluginCatalogResponse(value: unknown): value is PluginCatalogResponse {
  return isRecord(value) && Array.isArray(value.catalog);
}


function isPluginTrustedKeysResponse(
  value: unknown,
): value is PluginTrustedKeysResponse {
  return isRecord(value) && Array.isArray(value.keys);
}


function isPluginRegistryUrlResponse(
  value: unknown,
): value is PluginRegistryUrlResponse {
  return isRecord(value) && typeof value.url === 'string';
}


function isPluginLlmWikiSettingsResponse(
  value: unknown,
): value is PluginLlmWikiSettingsResponse {
  return (
    isRecord(value) &&
    isRecord(value.config) &&
    isRecord(value.brain) &&
    isRecord(value.capabilities) &&
    isRecord(value.index_options) &&
    isRecord(value.validation)
  );
}


function isPluginLlmWikiMaintenanceResponse(
  value: unknown,
): value is PluginLlmWikiMaintenanceResponse {
  return (
    isRecord(value) &&
    isRecord(value.lint) &&
    typeof value.suggestions_pending === 'number' &&
    typeof value.suggestions_queued === 'number'
  );
}


function requirePayload<T>(
  result: ApiResult<unknown>,
  predicate: (value: unknown) => value is T,
  description: string,
): T {
  assertApiSuccess(result);
  if (!predicate(result.data)) {
    throw new GnosiApiError(
      result.response,
      `The API returned an invalid ${description}`,
    );
  }
  return result.data;
}


export async function fetchPluginState(
  signal?: AbortSignal,
): Promise<PluginState> {
  return requirePayload(
    await apiClient.GET('/api/vault/plugins', { signal }),
    isPluginState,
    'plugin state',
  );
}


export async function setPluginLifecycle(
  pluginId: string,
  input: PluginLifecycleInput,
  signal?: AbortSignal,
): Promise<PluginState> {
  return requirePayload(
    await apiClient.POST('/api/vault/plugins/{plugin_id}/lifecycle', {
      body: input,
      params: { path: { plugin_id: pluginId } },
      signal,
    }),
    isPluginState,
    'plugin lifecycle state',
  );
}


export async function fetchInstalledPlugins(
  signal?: AbortSignal,
): Promise<InstalledPluginsResponse> {
  return requirePayload(
    await apiClient.GET('/api/vault/plugins/installed', { signal }),
    isInstalledPluginsResponse,
    'installed plugin inventory',
  );
}


export async function fetchPluginPermissionsCatalog(
  signal?: AbortSignal,
): Promise<PluginPermissionsCatalog> {
  return requirePayload(
    await apiClient.GET('/api/vault/plugins/catalog', { signal }),
    isPluginPermissionsCatalog,
    'plugin permission catalog',
  );
}


export async function fetchPluginCatalog(
  signal?: AbortSignal,
): Promise<PluginCatalogResponse> {
  return requirePayload(
    await apiClient.GET('/api/vault/plugins/catalog/list', { signal }),
    isPluginCatalogResponse,
    'plugin catalog',
  );
}


export async function fetchPluginTrustedKeys(
  signal?: AbortSignal,
): Promise<PluginTrustedKeysResponse> {
  return requirePayload(
    await apiClient.GET('/api/vault/plugins/trust', { signal }),
    isPluginTrustedKeysResponse,
    'plugin trusted-key list',
  );
}


export async function fetchPluginRegistryUrl(
  signal?: AbortSignal,
): Promise<PluginRegistryUrlResponse> {
  return requirePayload(
    await apiClient.GET('/api/vault/plugins/registry-url', { signal }),
    isPluginRegistryUrlResponse,
    'plugin registry URL',
  );
}


export async function setPluginRegistryUrl(
  url: string,
  signal?: AbortSignal,
): Promise<void> {
  assertApiSuccess(
    await apiClient.PUT('/api/vault/plugins/registry-url', {
      body: { url },
      signal,
    }),
  );
}


export async function addPluginTrustedKey(
  input: PluginTrustedKeyInput,
  signal?: AbortSignal,
): Promise<void> {
  assertApiSuccess(
    await apiClient.POST('/api/vault/plugins/trust', { body: input, signal }),
  );
}


export async function removePluginTrustedKey(
  name: string,
  signal?: AbortSignal,
): Promise<void> {
  assertApiSuccess(
    await apiClient.DELETE('/api/vault/plugins/trust/{name}', {
      params: { path: { name } },
      signal,
    }),
  );
}


export async function setPluginPermissions(
  pluginId: string,
  permissions: readonly string[],
  signal?: AbortSignal,
): Promise<void> {
  assertApiSuccess(
    await apiClient.POST('/api/vault/plugins/{plugin_id}/permissions', {
      body: { permissions: [...permissions] },
      params: { path: { plugin_id: pluginId } },
      signal,
    }),
  );
}


export async function installPluginFromCatalog(
  pluginId: string,
  signal?: AbortSignal,
): Promise<void> {
  const body = { id: pluginId } as components['schemas']['CatalogInstallRequest'];
  assertApiSuccess(
    await apiClient.POST('/api/vault/plugins/catalog/install', { body, signal }),
  );
}


export async function uninstallPlugin(
  pluginId: string,
  signal?: AbortSignal,
): Promise<void> {
  assertApiSuccess(
    await apiClient.DELETE('/api/vault/plugins/{plugin_id}', {
      params: { path: { plugin_id: pluginId } },
      signal,
    }),
  );
}


export async function submitPluginPackage(
  pluginId: string,
  signal?: AbortSignal,
): Promise<void> {
  assertApiSuccess(
    await apiClient.POST('/api/vault/plugins/{plugin_id}/submissions', {
      params: { path: { plugin_id: pluginId } },
      signal,
    }),
  );
}


export async function fetchPluginLlmWikiConfig(
  signal?: AbortSignal,
): Promise<PluginLlmWikiSettingsResponse> {
  return requirePayload(
    await fetchLlmWikiConfigResult(signal),
    isPluginLlmWikiSettingsResponse,
    'LLM Wiki configuration',
  );
}


export async function savePluginLlmWikiConfig(
  input: PluginLlmWikiSettingsDocument,
  signal?: AbortSignal,
): Promise<PluginLlmWikiSettingsResponse> {
  const response = requirePayload(
    await apiClient.PUT('/api/vault/llm-wiki/config', { body: input, signal }),
    isPluginLlmWikiSettingsResponse,
    'LLM Wiki configuration',
  );
  await invalidateLlmWikiConfig();
  return response;
}


export async function runPluginLlmWikiMaintenance(
  semantic: boolean,
  signal?: AbortSignal,
): Promise<PluginLlmWikiMaintenanceResponse> {
  return requirePayload(
    await apiClient.POST('/api/vault/llm-wiki/maintenance', {
      params: { query: { semantic } },
      signal,
    }),
    isPluginLlmWikiMaintenanceResponse,
    'LLM Wiki maintenance result',
  );
}


export async function createPluginLlmWikiBrain(
  uiLocale: string,
  signal?: AbortSignal,
): Promise<PluginLlmWikiSettingsResponse> {
  const response = requirePayload(
    await apiClient.POST('/api/vault/llm-wiki/brain/create', {
      body: { ui_locale: uiLocale },
      signal,
    }),
    isPluginLlmWikiSettingsResponse,
    'LLM Wiki Brain creation result',
  );
  await invalidateLlmWikiConfig();
  return response;
}
