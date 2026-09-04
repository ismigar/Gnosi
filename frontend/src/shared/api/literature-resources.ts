import type { components } from '../../generated/openapi';
import { bootstrapQueryKeys } from './bootstrap-query-keys';
import { fetchCachedQuery, invalidateCachedQuery } from './cached-query';
import { apiClient } from './client';
import {
  GnosiApiError,
  type ApiResult,
  unwrapApiResult,
} from './errors';

type JsonRecord = Record<string, unknown>;

export interface LiteratureSynchronization {
  readonly cancel_requested?: boolean;
  readonly deleted_count?: number;
  readonly error?: string | null;
  readonly index_size?: number;
  readonly indexed_count?: number;
  readonly job_id?: string | null;
  readonly received_count?: number;
  readonly source_id?: string;
  readonly state: string;
  readonly [key: string]: unknown;
}

export interface LiteratureSource {
  readonly automated?: boolean;
  readonly available?: boolean;
  readonly credential_status?: string;
  readonly enabled?: boolean;
  readonly hidden?: boolean;
  readonly id: string;
  readonly implemented?: boolean;
  readonly kind: string;
  readonly name: string;
  readonly requires_contact?: boolean;
  readonly search_url?: string;
  readonly sync?: LiteratureSynchronization;
  readonly [key: string]: unknown;
}

export interface LiteratureConfiguration {
  readonly ai_agent_id: string;
  readonly ai_agents: readonly JsonRecord[];
  readonly contact_email: string;
  readonly hidden_sources: readonly string[];
  readonly source_defaults: Readonly<Record<string, boolean>>;
  readonly sources: readonly LiteratureSource[];
  readonly [key: string]: unknown;
}

export interface LiteratureConfigurationPatch {
  readonly ai_agent_id?: string | null;
  readonly contact_email?: string | null;
  readonly hidden_sources?: string[] | null;
  readonly source_defaults?: Record<string, boolean> | null;
}

export type LiteratureRepositoryInput =
  components['schemas']['RepositoryPayload'];
export type LiteratureRepositoryTestInput =
  components['schemas']['RepositoryTestPayload'] & { readonly id?: string };

export interface LiteratureRepository {
  readonly base_url: string;
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly [key: string]: unknown;
}

export interface LiteratureRepositoryTest {
  readonly count: number;
  readonly latency_ms: number;
  readonly ok: boolean;
  readonly sample: readonly JsonRecord[];
  readonly [key: string]: unknown;
}

export interface LiteratureRepositoryDeletion {
  readonly deleted: boolean;
  readonly index_records_deleted: number;
  readonly repository_id: string;
  readonly [key: string]: unknown;
}

export interface ReferenceTableStatus {
  readonly columns_added?: number;
  readonly configured: boolean;
  readonly created?: boolean;
  readonly name?: string | null;
  readonly table_id: string | null;
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSource(value: unknown): value is LiteratureSource {
  return (
    isRecord(value)
    && typeof value.id === 'string'
    && typeof value.kind === 'string'
    && typeof value.name === 'string'
  );
}

function isConfiguration(value: unknown): value is LiteratureConfiguration {
  return (
    isRecord(value)
    && typeof value.ai_agent_id === 'string'
    && Array.isArray(value.ai_agents)
    && value.ai_agents.every(isRecord)
    && typeof value.contact_email === 'string'
    && isStringArray(value.hidden_sources)
    && isRecord(value.source_defaults)
    && Array.isArray(value.sources)
    && value.sources.every(isSource)
  );
}

function isRepository(value: unknown): value is LiteratureRepository {
  return (
    isRecord(value)
    && typeof value.base_url === 'string'
    && typeof value.id === 'string'
    && typeof value.kind === 'string'
    && typeof value.name === 'string'
  );
}

function isRepositoryTest(value: unknown): value is LiteratureRepositoryTest {
  return (
    isRecord(value)
    && typeof value.count === 'number'
    && typeof value.latency_ms === 'number'
    && value.ok === true
    && Array.isArray(value.sample)
    && value.sample.every(isRecord)
  );
}

function isRepositoryDeletion(
  value: unknown,
): value is LiteratureRepositoryDeletion {
  return (
    isRecord(value)
    && typeof value.deleted === 'boolean'
    && typeof value.index_records_deleted === 'number'
    && typeof value.repository_id === 'string'
  );
}

function isSynchronization(
  value: unknown,
): value is LiteratureSynchronization {
  return (
    isRecord(value)
    && typeof value.source_id === 'string'
    && typeof value.state === 'string'
  );
}

function isReferenceTableStatus(value: unknown): value is ReferenceTableStatus {
  return (
    isRecord(value)
    && typeof value.configured === 'boolean'
    && (value.table_id === null || typeof value.table_id === 'string')
  );
}

function validated<T>(
  result: ApiResult<unknown>,
  guard: (value: unknown) => value is T,
  message: string,
): T {
  const payload = unwrapApiResult<unknown, unknown>(result);
  if (!guard(payload)) throw new GnosiApiError(result.response, message);
  return payload;
}

export async function fetchLiteratureConfiguration(
  signal?: AbortSignal,
): Promise<LiteratureConfiguration> {
  return validated(
    await apiClient.GET('/api/vault/literature/configuration', { signal }),
    isConfiguration,
    'The API returned an invalid literature configuration',
  );
}

export async function updateLiteratureConfiguration(
  input: LiteratureConfigurationPatch,
  signal?: AbortSignal,
): Promise<LiteratureConfiguration> {
  return validated(
    await apiClient.PUT('/api/vault/literature/configuration', {
      body: input,
      signal,
    }),
    isConfiguration,
    'The API returned an invalid literature configuration',
  );
}

export async function createLiteratureRepository(
  input: LiteratureRepositoryInput,
  signal?: AbortSignal,
): Promise<LiteratureRepository> {
  return validated(
    await apiClient.POST('/api/vault/literature/repositories', {
      body: input,
      signal,
    }),
    isRepository,
    'The API returned an invalid literature repository',
  );
}

export async function updateLiteratureRepository(
  repositoryId: string,
  input: LiteratureRepositoryInput,
  signal?: AbortSignal,
): Promise<LiteratureRepository> {
  return validated(
    await apiClient.PUT('/api/vault/literature/repositories/{repository_id}', {
      body: input,
      params: { path: { repository_id: repositoryId } },
      signal,
    }),
    isRepository,
    'The API returned an invalid literature repository',
  );
}

export async function testLiteratureRepository(
  input: LiteratureRepositoryTestInput,
  signal?: AbortSignal,
): Promise<LiteratureRepositoryTest> {
  return validated(
    await apiClient.POST('/api/vault/literature/repositories/test', {
      body: input,
      signal,
    }),
    isRepositoryTest,
    'The API returned an invalid literature repository test',
  );
}

export async function deleteLiteratureRepository(
  repositoryId: string,
  deleteIndex = false,
  signal?: AbortSignal,
): Promise<LiteratureRepositoryDeletion> {
  return validated(
    await apiClient.DELETE(
      '/api/vault/literature/repositories/{repository_id}',
      {
        params: {
          path: { repository_id: repositoryId },
          query: { confirm: true, delete_index: deleteIndex },
        },
        signal,
      },
    ),
    isRepositoryDeletion,
    'The API returned an invalid literature repository deletion',
  );
}

export async function startLiteratureSynchronization(
  sourceId: string,
  full = false,
  signal?: AbortSignal,
): Promise<LiteratureSynchronization> {
  return validated(
    await apiClient.POST('/api/vault/literature/synchronizations/{source_id}', {
      body: { full },
      params: { path: { source_id: sourceId } },
      signal,
    }),
    isSynchronization,
    'The API returned an invalid literature synchronization',
  );
}

export async function cancelLiteratureSynchronization(
  sourceId: string,
  signal?: AbortSignal,
): Promise<LiteratureSynchronization> {
  return validated(
    await apiClient.DELETE('/api/vault/literature/synchronizations/{source_id}', {
      params: { path: { source_id: sourceId } },
      signal,
    }),
    isSynchronization,
    'The API returned an invalid literature synchronization',
  );
}

export async function resumeLiteratureSynchronization(
  sourceId: string,
  signal?: AbortSignal,
): Promise<LiteratureSynchronization> {
  return validated(
    await apiClient.POST(
      '/api/vault/literature/synchronizations/{source_id}/resume',
      { params: { path: { source_id: sourceId } }, signal },
    ),
    isSynchronization,
    'The API returned an invalid literature synchronization',
  );
}

export async function fetchReferenceTable(
  signal?: AbortSignal,
): Promise<ReferenceTableStatus> {
  return fetchCachedQuery({
    queryFn: async (sharedSignal) => validated(
      await apiClient.GET('/api/vault/reference-table', { signal: sharedSignal }),
      isReferenceTableStatus,
      'The API returned an invalid Resources table designation',
    ),
    queryKey: bootstrapQueryKeys.referenceTable(),
    signal,
  });
}

export async function invalidateReferenceTable(): Promise<void> {
  await invalidateCachedQuery(bootstrapQueryKeys.referenceTable());
}

export async function setReferenceTable(
  tableId: string,
  signal?: AbortSignal,
): Promise<ReferenceTableStatus> {
  const result = validated(
    await apiClient.POST('/api/vault/reference-table', {
      body: { table_id: tableId },
      signal,
    }),
    isReferenceTableStatus,
    'The API returned an invalid Resources table designation',
  );
  await invalidateReferenceTable();
  return result;
}

export async function clearReferenceTable(
  signal?: AbortSignal,
): Promise<ReferenceTableStatus> {
  const result = validated(
    await apiClient.DELETE('/api/vault/reference-table', { signal }),
    isReferenceTableStatus,
    'The API returned an invalid Resources table designation',
  );
  await invalidateReferenceTable();
  return result;
}

export async function createReferenceTable(
  signal?: AbortSignal,
): Promise<ReferenceTableStatus> {
  const result = validated(
    await apiClient.POST('/api/vault/reference-table/create', {
      body: {},
      signal,
    }),
    isReferenceTableStatus,
    'The API returned an invalid Resources table designation',
  );
  await invalidateReferenceTable();
  return result;
}
