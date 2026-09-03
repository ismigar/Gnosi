import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import type { ChatSessionIdentity } from './chat-sessions';

export type ChatFeedback = components['schemas']['ChatFeedbackRequest'];
export type ChatRewind = components['schemas']['ChatRewindRequest'];
export type JobAction = 'status' | 'resume' | 'cancel';

export async function recordChatFeedback(body: ChatFeedback): Promise<void> {
  const { response } = await apiClient.POST('/api/chat/feedback', { body, parseAs: 'text' });
  if (!response.ok) throw new Error(`Assistant feedback failed (${String(response.status)})`);
}

export async function requestChatMessageJob(jobId: string, action: JobAction): Promise<unknown> {
  const params = { path: { job_id: jobId } };
  const result = action === 'status'
    ? await apiClient.GET('/api/ai/jobs/{job_id}', { params })
    : action === 'resume'
      ? await apiClient.POST('/api/ai/jobs/{job_id}/resume', { params })
      : await apiClient.POST('/api/ai/jobs/{job_id}/cancel', { params });
  if (!result.response.ok) throw new Error(`Capability job request failed (${String(result.response.status)})`);
  return result.data;
}

export async function rewindChatSession(session: ChatSessionIdentity, body: ChatRewind, notebookId = ''): Promise<unknown> {
  const result = await apiClient.POST('/api/chat/sessions/{agent_id}/{session_id}/rewind', {
    params: { path: { agent_id: session.agentId, session_id: session.id }, query: { notebook_id: notebookId || undefined } }, body,
  });
  if (!result.response.ok) throw new Error(`Conversation rewind failed (${String(result.response.status)})`);
  const data: unknown = result.data;
  if (data === null || typeof data !== 'object') throw new Error('Conversation rewind returned an invalid response');
  return 'messages' in data ? data.messages : undefined;
}
