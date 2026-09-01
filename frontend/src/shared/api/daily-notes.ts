import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type DailyNoteSummary = components['schemas']['DailyNoteSummaryResponse'];
export type DailyNoteDocument = components['schemas']['DailyNoteDocumentResponse'];
export type DailyNoteRequest = components['schemas']['DailyNoteRequest'];


export async function fetchDailyNotes(
  signal?: AbortSignal,
): Promise<DailyNoteSummary[]> {
  return unwrapApiResult<DailyNoteSummary[], unknown>(
    await apiClient.GET('/api/vault/daily', { signal }),
  );
}


export async function openDailyNote(
  input: DailyNoteRequest,
  signal?: AbortSignal,
): Promise<DailyNoteDocument> {
  return unwrapApiResult<DailyNoteDocument, unknown>(
    await apiClient.POST('/api/vault/daily', { body: input, signal }),
  );
}
