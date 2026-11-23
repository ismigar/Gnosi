import { isRecord, stringifyLooseValue } from '../model/agentChatMessageTypes';
import { boundedProcessingMs, boundedTransparencyMetadata, boundedTurnMetrics, mergeCanonicalMessageMetadata, mergeNotebookConversation } from '../model/agentChatMessageUtils';
import type { StoredChatMessage } from './sessionModel';
import { assistantProfileSnapshot } from '../model/agentChatAuthor';
import { explicitTurnId } from '../model/agentChatTurnIdentity';

/** Live history is not the storage codec: never truncate content or scrub a pending action here. */
export function readLiveChatMessages(value: unknown): StoredChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((message) => ({
    ...message,
    role: typeof message.role === 'string' ? message.role : undefined,
    content: stringifyLooseValue(message.content || ''),
    assistant_profile: assistantProfileSnapshot(message.assistant_profile),
    confirmation: isRecord(message.confirmation) && typeof message.confirmation.confirmation_id === 'string'
      ? { ...message.confirmation, confirmation_id: message.confirmation.confirmation_id } : undefined,
    processingMs: boundedProcessingMs(message.processingMs),
    timings: boundedTurnMetrics(message.timings),
    ...boundedTransparencyMetadata(message),
  }));
}

function isPreparationError(row: StoredChatMessage): boolean {
  return row.role === 'assistant' && typeof row.errorCode === 'string' && !!row.errorCode
    && row.timings?.model_calls === 0 && !!row.timings.setup_breakdown_ms;
}

export function hydrateChatMessages(canonical: unknown, cached: readonly StoredChatMessage[], notebook = false): StoredChatMessage[] {
  const merge = notebook ? mergeNotebookConversation : mergeCanonicalMessageMetadata;
  const failedTurns = new Set<string>();
  for (const row of cached) {
    const id = explicitTurnId(row);
    if (id && isPreparationError(row)) failedTurns.add(id);
  }
  if (!failedTurns.size || !Array.isArray(canonical) || !canonical.length) return readLiveChatMessages(merge(canonical, cached));

  // A failure before the workflow starts never enters the model's checkpoint.
  // Keep its prompt and diagnostic together without matching them to a later answer.
  const checkpointCache = cached.filter(row => !isPreparationError(row) && (row.role !== 'user' || !failedTurns.has(explicitTurnId(row) ?? '')));
  const history = readLiveChatMessages(merge(canonical, checkpointCache));
  const ends = new Map<string, number>();
  const legacyRows = new Map<string, number | undefined>();
  history.forEach((row, index) => {
    const id = explicitTurnId(row);
    if (id) ends.set(id, index + 1);
    else {
      const key = JSON.stringify([row.role, row.content]);
      legacyRows.set(key, legacyRows.has(key) ? undefined : index + 1);
    }
  });
  const inserts = new Map<number, StoredChatMessage[]>();
  let position: number | undefined = 0;
  for (const row of cached) {
    if (row.role !== 'user' && row.role !== 'assistant') continue;
    const id = explicitTurnId(row);
    if (id && failedTurns.has(id) && !ends.has(id) && (row.role === 'user' || isPreparationError(row))) {
      if (position !== undefined) {
        const group = inserts.get(position) ?? [];
        group.push(row);
        inserts.set(position, group);
      }
    } else {
      // A checkpoint rewind can remove the local branch that an error followed.
      position = id ? ends.get(id) : legacyRows.get(JSON.stringify([row.role, row.content]));
    }
  }
  return [...(inserts.get(0) ?? []), ...history.flatMap((row, index) => [row, ...(inserts.get(index + 1) ?? [])])];
}
