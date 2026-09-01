import { isRecord, stringifyLooseValue } from '../model/agentChatMessageTypes';
import { boundedProcessingMs, boundedTransparencyMetadata, boundedTurnMetrics, mergeCanonicalMessageMetadata, mergeNotebookConversation } from '../model/agentChatMessageUtils';
import type { StoredChatMessage } from './sessionModel';

/** Live history is not the storage codec: never truncate content or scrub a pending action here. */
export function readLiveChatMessages(value: unknown): StoredChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((message) => ({
    ...message,
    role: typeof message.role === 'string' ? message.role : undefined,
    content: stringifyLooseValue(message.content || ''),
    confirmation: isRecord(message.confirmation) && typeof message.confirmation.confirmation_id === 'string'
      ? { ...message.confirmation, confirmation_id: message.confirmation.confirmation_id } : undefined,
    processingMs: boundedProcessingMs(message.processingMs),
    timings: boundedTurnMetrics(message.timings),
    ...boundedTransparencyMetadata(message),
  }));
}

export function hydrateChatMessages(canonical: unknown, cached: readonly StoredChatMessage[], notebook = false): StoredChatMessage[] {
  return readLiveChatMessages(notebook ? mergeNotebookConversation(canonical, cached) : mergeCanonicalMessageMetadata(canonical, cached));
}
