import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type MeetingStart = components['schemas']['MeetingStartResponse'];
export type MeetingStatus = components['schemas']['MeetingStatusResponse'];


export async function fetchMeetingStatus(
  signal?: AbortSignal,
): Promise<MeetingStatus> {
  return unwrapApiResult<MeetingStatus, unknown>(
    await apiClient.GET('/api/meetings/status', { signal }),
  );
}
