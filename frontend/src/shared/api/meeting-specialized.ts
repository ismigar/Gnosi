import type { MeetingStart } from './meetings';
import { GnosiApiError } from './errors';
import { transportFetch } from './transports';


export type MeetingMode = 'online' | 'presencial';


export async function uploadMeetingRecording(
  audio: Blob,
  title: string,
  mode: MeetingMode,
  signal?: AbortSignal,
): Promise<MeetingStart> {
  const body = new FormData();
  body.set('audio', audio, 'meeting.webm');
  body.set('title', title);
  body.set('mode', mode);

  const response = await transportFetch('/api/meetings/record', {
    body,
    method: 'POST',
    signal,
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new GnosiApiError(response, payload);
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('status' in payload) ||
    typeof payload.status !== 'string'
  ) {
    throw new GnosiApiError(response, 'The API returned an invalid meeting status');
  }
  return { status: payload.status };
}
