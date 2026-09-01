import { apiClient } from './client';
import { assertApiSuccess } from './errors';

export interface ChatSessionIdentity { readonly agentId: string; readonly id: string }

export async function deleteChatSessionCheckpoint(session: ChatSessionIdentity | null | undefined): Promise<boolean> {
  if (!session?.agentId || !session.id) return true;
  const result = await apiClient.DELETE('/api/chat/sessions/{agent_id}/{session_id}', {
    params: { path: { agent_id: session.agentId, session_id: session.id } }, parseAs: 'text',
  });
  assertApiSuccess(result);
  return true;
}

export async function fetchChatSessionHistory(session: ChatSessionIdentity, notebookId = ''): Promise<unknown> {
  const result = await apiClient.GET('/api/chat/sessions/{agent_id}/{session_id}', {
    params: { path: { agent_id: session.agentId, session_id: session.id }, query: { notebook_id: notebookId || undefined } },
  });
  if (!result.response.ok || typeof result.data !== 'object' || result.data === null || !('messages' in result.data)) return null;
  return result.data.messages;
}
