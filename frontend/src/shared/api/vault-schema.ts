import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult, type ApiResult } from './errors';


export type JsonValue = components['schemas']['JsonValue'];
export type JsonRecord = components['schemas']['RegistryRecord'];

export interface AgentSkillCatalogResponse extends JsonRecord {
  catalog_revision: string;
  issues: JsonRecord[];
  skills: JsonRecord[];
}

export interface GenerateButtonActionInput {
  [key: string]: unknown;
  fields: Array<{ name: string; type: string }>;
  prompt: string;
}

export interface GenerateButtonActionResponse extends JsonRecord {
  result: JsonRecord;
  status: string;
}

export interface DrupalContentTypesResponse extends JsonRecord {
  content_types: JsonRecord[];
}

export interface DrupalFieldsResponse extends JsonRecord {
  bundle: string;
  fields: JsonRecord[];
}

export interface VirtualFieldsResponse extends JsonRecord {
  computers: JsonRecord[];
}


function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function requireJsonRecord(value: unknown, label: string): JsonRecord {
  if (!isJsonRecord(value)) {
    throw new TypeError(`The ${label} API returned an invalid JSON object`);
  }
  return value;
}


function requireJsonRecords(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value) || !value.every(isJsonRecord)) {
    throw new TypeError(`The ${label} API returned an invalid JSON array`);
  }
  return value;
}


function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`The ${label} API returned an invalid string`);
  }
  return value;
}


function unwrapJsonRecord(
  result: ApiResult<unknown>,
  label: string,
): JsonRecord {
  return requireJsonRecord(unwrapApiResult<unknown, unknown>(result), label);
}


export async function fetchAvailableAgentSkills(
  signal?: AbortSignal,
): Promise<AgentSkillCatalogResponse> {
  const payload = unwrapJsonRecord(
    await apiClient.GET('/api/ai/skills', { signal }),
    'agent skills',
  );
  return {
    ...payload,
    catalog_revision: requireString(
      payload.catalog_revision,
      'agent skills catalog revision',
    ),
    issues: requireJsonRecords(payload.issues, 'agent skill issues'),
    skills: requireJsonRecords(payload.skills, 'agent skills'),
  };
}


export async function generateButtonAction(
  input: GenerateButtonActionInput,
): Promise<GenerateButtonActionResponse> {
  const payload = unwrapJsonRecord(
    await apiClient.POST('/api/vault/skills/generate-button-action', {
      body: input,
    }),
    'button action generation',
  );
  return {
    ...payload,
    result: requireJsonRecord(payload.result, 'generated button action'),
    status: requireString(payload.status, 'button action status'),
  };
}


export async function fetchOptionCatalogs(
  signal?: AbortSignal,
): Promise<JsonRecord> {
  return unwrapJsonRecord(
    await apiClient.GET('/api/vault/option-catalogs', { signal }),
    'option catalogs',
  );
}


export async function fetchVirtualFields(
  signal?: AbortSignal,
): Promise<VirtualFieldsResponse> {
  const payload = unwrapJsonRecord(
    await apiClient.GET('/api/vault/virtual-fields', { signal }),
    'virtual fields',
  );
  return {
    ...payload,
    computers: requireJsonRecords(payload.computers, 'virtual field computers'),
  };
}


export async function fetchTableOptionUsage(
  tableId: string,
  fieldId: string,
  signal?: AbortSignal,
): Promise<JsonRecord> {
  return unwrapJsonRecord(
    await apiClient.GET('/api/vault/tables/{table_id}/options/usage', {
      params: {
        path: { table_id: tableId },
        query: { field_id: fieldId },
      },
      signal,
    }),
    'table option usage',
  );
}


export async function renameTableOption(
  tableId: string,
  fieldId: string,
  oldValue: string,
  newValue: string,
): Promise<JsonRecord> {
  return unwrapJsonRecord(
    await apiClient.POST('/api/vault/tables/{table_id}/options/rename', {
      body: { field_id: fieldId, new: newValue, old: oldValue },
      params: { path: { table_id: tableId } },
    }),
    'table option rename',
  );
}


export async function removeTableOption(
  tableId: string,
  fieldId: string,
  value: string,
  reassignTo?: string,
): Promise<JsonRecord> {
  return unwrapJsonRecord(
    await apiClient.POST('/api/vault/tables/{table_id}/options/remove', {
      body: {
        field_id: fieldId,
        reassign_to: reassignTo || undefined,
        value,
      },
      params: { path: { table_id: tableId } },
    }),
    'table option removal',
  );
}


export async function updateOptionCatalog(
  name: string,
  options: JsonValue[],
): Promise<JsonRecord> {
  return unwrapJsonRecord(
    await apiClient.PUT('/api/vault/option-catalogs/{name}', {
      body: { options },
      params: { path: { name } },
    }),
    'option catalog update',
  );
}


export async function matchDrupalRows(tableId: string): Promise<JsonRecord> {
  return unwrapJsonRecord(
    await apiClient.POST('/api/vault/skills/match-drupal-rows', {
      body: { dry_run: false, table_id: tableId },
    }),
    'Drupal row matching',
  );
}


export async function fetchDrupalContentTypes(
  signal?: AbortSignal,
): Promise<DrupalContentTypesResponse> {
  const payload = unwrapJsonRecord(
    await apiClient.GET('/api/vault/drupal/content-types', { signal }),
    'Drupal content types',
  );
  return {
    ...payload,
    content_types: requireJsonRecords(
      payload.content_types,
      'Drupal content types',
    ),
  };
}


export async function fetchDrupalFields(
  bundle: string,
  signal?: AbortSignal,
): Promise<DrupalFieldsResponse> {
  const payload = unwrapJsonRecord(
    await apiClient.GET('/api/vault/drupal/content-types/{bundle}/fields', {
      params: { path: { bundle } },
      signal,
    }),
    'Drupal fields',
  );
  return {
    ...payload,
    bundle: requireString(payload.bundle, 'Drupal bundle'),
    fields: requireJsonRecords(payload.fields, 'Drupal fields'),
  };
}


export async function saveVaultFolderSchema(
  folder: string,
  schema: JsonRecord,
): Promise<JsonRecord> {
  return unwrapJsonRecord(
    await apiClient.POST('/api/vault/schema', {
      body: schema,
      params: { query: { folder } },
    }),
    'Vault folder schema',
  );
}
