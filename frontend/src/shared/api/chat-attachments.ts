import type { components } from '../../generated/openapi';
import { apiClient } from './client';

type AttachmentScope = Pick<components['schemas']['AttachmentDeleteRequest'], 'agent_id' | 'session_id'>;

export async function uploadChatAttachment(file: File, scope: AttachmentScope, fallback: string): Promise<string | null> {
  const result = await apiClient.POST('/api/chat/attachments', {
    body: { ...scope, file: file.name },
    bodySerializer: () => {
      const data = new FormData();
      data.append('file', file);
      data.append('agent_id', scope.agent_id);
      data.append('session_id', scope.session_id);
      return data;
    },
  });
  if (!result.response.ok) {
    const error: unknown = result.error;
    const detail = typeof error === 'string' ? error : error ? JSON.stringify(error) : '';
    throw new Error(detail || fallback);
  }
  const data: unknown = result.data;
  return typeof data === 'object' && data !== null && 'path' in data && typeof data.path === 'string' ? data.path || null : null;
}

export async function removeChatAttachment(path: string | null, scope: AttachmentScope): Promise<void> {
  if (!path) return;
  // Cleanup is best effort: retain the legacy policy of ignoring non-2xx results.
  await apiClient.DELETE('/api/chat/attachments', { body: { path, ...scope }, parseAs: 'text' });
}
