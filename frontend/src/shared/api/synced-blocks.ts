import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type SyncedBlockDocument = components['schemas']['SyncedBlockResponse'];
export type SyncedBlockSaveResult =
  components['schemas']['SyncedBlockSaveResponse'];


export async function fetchSyncedBlock(
  syncId: string,
  signal?: AbortSignal,
): Promise<SyncedBlockDocument> {
  return unwrapApiResult<SyncedBlockDocument, unknown>(
    await apiClient.GET('/api/vault/synced/{sync_id}', {
      params: { path: { sync_id: syncId } },
      signal,
    }),
  );
}


export async function saveSyncedBlock(
  syncId: string,
  content: string,
  signal?: AbortSignal,
): Promise<SyncedBlockSaveResult> {
  return unwrapApiResult<SyncedBlockSaveResult, unknown>(
    await apiClient.PUT('/api/vault/synced/{sync_id}', {
      body: { content },
      params: { path: { sync_id: syncId } },
      signal,
    }),
  );
}
