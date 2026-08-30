import { deleteChatSessionCheckpoint, type ChatSessionIdentity } from '../../shared/api/chat-sessions';
import { readChatStorage, writeChatStorage } from './chatPersistence';
import { checkpointIdentities, parseStoredSessions } from './sessionRestore';

export function queueCheckpointDeletion(key: string, session: ChatSessionIdentity): void {
  if (!session.agentId || !session.id) return;
  const pending = checkpointIdentities(parseStoredSessions(readChatStorage(key)));
  const unique = new Map([...pending, session].map((item) => [`${item.agentId}:${item.id}`, item]));
  writeChatStorage(key, JSON.stringify([...unique.values()]));
}

export async function retryCheckpointDeletions(key: string): Promise<void> {
  const pending = checkpointIdentities(parseStoredSessions(readChatStorage(key)));
  if (!pending.length) return;
  const failed: ChatSessionIdentity[] = [];
  for (const session of pending) {
    try { await deleteChatSessionCheckpoint(session); }
    catch { failed.push(session); }
  }
  writeChatStorage(key, JSON.stringify(failed));
}
