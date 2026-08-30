import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { streamFetch } from './specialized-transports';
import type { NdjsonRecord } from './ndjson';

// The 2.x client also carries a nullable upload path and optional remote URL.
// Preserve that wire shape until the backend's open attachment contract is reconciled.
export type StreamAttachment = Omit<components['schemas']['AttachmentRef'], 'path'> & {
  readonly path: string | null;
  readonly url: string | null;
};
export type ChatStreamRequest = Omit<components['schemas']['ChatRequest'], 'attachments'> & {
  readonly attachments?: readonly StreamAttachment[];
};
export interface ChatStreamIdentity { readonly streamId: string; readonly agentId: string; readonly sessionId: string }

export function startChatStream(body: ChatStreamRequest, signal: AbortSignal): Promise<Response> {
  return streamFetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
}

export async function readChatStreamReplay(identity: ChatStreamIdentity, afterSequence: number): Promise<readonly NdjsonRecord[] | null> {
  const result = await apiClient.GET('/api/chat/streams/{stream_id}', {
    params: { path: { stream_id: identity.streamId }, query: { agent_id: identity.agentId, session_id: identity.sessionId, after_sequence: afterSequence } }, parseAs: 'text',
  });
  if (!result.response.ok) return null;
  return (result.data ?? '').split('\n').filter(Boolean).map((line) => {
    const record: unknown = JSON.parse(line);
    if (typeof record !== 'object' || record === null || Array.isArray(record)) throw new Error('Invalid chat replay record');
    return Object.fromEntries(Object.entries(record));
  });
}

export async function cancelChatStream(identity: ChatStreamIdentity): Promise<void> {
  // As in the legacy client, cancellation is best effort and does not block local abort.
  await apiClient.POST('/api/chat/streams/{stream_id}/cancel', {
    params: { path: { stream_id: identity.streamId }, query: { agent_id: identity.agentId, session_id: identity.sessionId } }, parseAs: 'text',
  });
}
