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
  const checkpointRows = canonical.filter(isRecord);
  const checkpointIds = new Set(checkpointRows.map(explicitTurnId).filter(id => id !== undefined));
  const positions = new Map<string, number[]>();
  function indexRow(key: string, index: number) {
    const matches = positions.get(key);
    if (matches) matches.push(index);
    else positions.set(key, [index]);
  }
  checkpointRows.forEach((row, index) => {
    const id = explicitTurnId(row);
    if (id) indexRow(JSON.stringify(['turn', row.role, id]), index);
    indexRow(JSON.stringify(['text', row.role, row.content]), index);
  });
  const inserts = new Map<number, StoredChatMessage[]>();
  let pending: StoredChatMessage[] = [];
  let cursor = 0;
  let followsRemovedTurn = false;
  function placePending(index: number | undefined) {
    if (pending.length && index !== undefined) inserts.set(index, [...(inserts.get(index) ?? []), ...pending]);
    pending = [];
  }
  for (const row of cached) {
    if (row.role !== 'user' && row.role !== 'assistant') continue;
    const id = explicitTurnId(row);
    if (id && failedTurns.has(id) && !checkpointIds.has(id) && (row.role === 'user' || isPreparationError(row))) {
      if (!followsRemovedTurn) pending.push(row);
      continue;
    }
    const strict = id ? positions.get(JSON.stringify(['turn', row.role, id])) : undefined;
    const text = positions.get(JSON.stringify(['text', row.role, row.content]));
    const index = strict?.find(i => i >= cursor)
      ?? text?.find(i => i >= cursor && (!id || !explicitTurnId(checkpointRows[i])));
    if (index !== undefined) {
      // The saved window can begin with a failure. Its next checkpoint row still fixes its position.
      placePending(index);
      cursor = index + 1;
      followsRemovedTurn = false;
    } else if (!id || !checkpointIds.has(id)) {
      placePending(cursor > 0 && !followsRemovedTurn ? cursor : undefined);
      followsRemovedTurn = true;
    }
  }
  placePending(followsRemovedTurn ? undefined : cursor || history.length);
  return [...(inserts.get(0) ?? []), ...history.flatMap((row, index) => [row, ...(inserts.get(index + 1) ?? [])])];
}
