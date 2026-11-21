import { readChatStreamReplay } from '../../../shared/api/chat-streaming';
import { isRecord } from '../model/agentChatMessageTypes';
import { applyChatStreamEvent } from './applyChatStreamEvent';
import { acceptStreamSequence } from './streamSequence';
import type { ChatStreamState, StreamEventContext } from './streamEventModel';

interface RecoveryRuntime { readonly pause?: () => Promise<void>; readonly signal?: AbortSignal }
const pauseBetweenPolls = () => new Promise<void>((resolve) => { window.setTimeout(resolve, 1000); });

/** Retrieve an existing stream only. Never repeat the POST that may have performed an action. */
export async function recoverChatStream(state: ChatStreamState, context: StreamEventContext, runtime: RecoveryRuntime = {}): Promise<boolean> {
  let recovered = false;
  const pause = runtime.pause ?? pauseBetweenPolls;
  for (let attempt = 0; attempt < 120 && !recovered; attempt += 1) {
    // A switched conversation no longer needs polling, and can never receive this response.
    if (runtime.signal?.aborted || context.activeScopeRef.current !== context.requestScope) return false;
    const events = await readChatStreamReplay({ streamId: state.streamId, agentId: context.agentId, sessionId: context.sessionId }, state.sequence, runtime.signal);
    if (events === null || runtime.signal?.aborted || context.activeScopeRef.current !== context.requestScope) break;
    for (const value of events) {
      if (!isRecord(value)) continue;
      if (value.type === 'done' || value.type === 'confirmation_required') {
        const sequence = acceptStreamSequence(value.sequence, state.sequence);
        if (!sequence.accepted) continue;
        state.sequence = sequence.sequence;
        // The confirmation status endpoint owns current action cards. A journal
        // can describe an already resolved action or a response we never saw.
        if (value.type === 'confirmation_required') {
          state.failed = true;
          state.responseReceived ||= typeof value.confirmation_id === 'string' && Boolean(value.confirmation_id);
        } else state.terminal = true;
      } else {
        applyChatStreamEvent(state, value, context);
      }
    }
    recovered = state.terminal && state.responseReceived;
    if (!recovered) await pause();
  }
  return recovered;
}
