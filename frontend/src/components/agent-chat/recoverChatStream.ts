import { readChatStreamReplay } from '../../shared/api/chat-streaming';
import { boundedTurnMetrics } from '../agentChatTiming';
import { boundedTransparencyMetadata } from '../agentChatTransparency';
import { isRecord, stringifyLooseValue, type LooseRecord } from '../agentChatMessageTypes';
import { acceptStreamSequence } from './streamSequence';
import { definedTransparency, lastTurnResponseIndex, type ChatStreamState, type StreamEventContext } from './streamEventModel';

interface RecoveryRuntime { readonly pause?: () => Promise<void> }
const pauseBetweenPolls = () => new Promise<void>((resolve) => { window.setTimeout(resolve, 1000); });

function applyRecoveredResponse(data: LooseRecord, state: ChatStreamState, context: StreamEventContext): void {
  const { setMessages, activeScopeRef, requestScope, turnId, t } = context;
  setMessages((previous) => {
    if (activeScopeRef.current !== requestScope) return previous;
    const index = lastTurnResponseIndex(previous, turnId);
    const content = data.type === 'error'
      ? `${t('chat.error_prefix', 'Error')}: ${stringifyLooseValue(data.content || t('errors.unknown', 'Unknown error'))}`
      : typeof data.content === 'string' ? data.content : '';
    const metadata = definedTransparency(boundedTransparencyMetadata({
      plan: data.plan, privacy: data.privacy, verification: data.verification, citations: data.citations,
      freshness: data.freshness, job: data.job, explanation: data.explanation, quality: data.quality,
      conflicts: data.conflicts, evidence_security: data.evidence_security,
    }));
    if (index < 0) return [...previous, { role: 'assistant', content, turnId, llm: state.model, ...metadata }];
    return previous.map((message, itemIndex) => itemIndex === index ? { ...message, content, turnId, ...metadata } : message);
  });
}

/** Retrieve an existing stream only. Never repeat the POST that may have performed an action. */
export async function recoverChatStream(state: ChatStreamState, context: StreamEventContext, runtime: RecoveryRuntime = {}): Promise<boolean> {
  let recovered = false;
  let responseSeen = false;
  const pause = runtime.pause ?? pauseBetweenPolls;
  for (let attempt = 0; attempt < 120 && !recovered; attempt += 1) {
    // A switched conversation no longer needs polling, and can never receive this response.
    if (context.activeScopeRef.current !== context.requestScope) return false;
    const events = await readChatStreamReplay({ streamId: state.streamId, agentId: context.agentId, sessionId: context.sessionId }, state.sequence);
    if (events === null) break;
    let terminal = false;
    let response: LooseRecord | null = null;
    for (const value of events) {
      if (!isRecord(value)) continue;
      const sequence = acceptStreamSequence(value.sequence, state.sequence);
      if (!sequence.accepted) continue;
      state.sequence = sequence.sequence;
      if (value.type === 'turn_metrics') state.metrics = boundedTurnMetrics(value);
      if (value.type === 'message' || value.type === 'thought' || value.type === 'error') response = value;
      if (value.type === 'done') terminal = true;
    }
    if (response) { responseSeen = true; applyRecoveredResponse(response, state, context); }
    recovered = terminal && responseSeen;
    if (!recovered) await pause();
  }
  return recovered;
}
