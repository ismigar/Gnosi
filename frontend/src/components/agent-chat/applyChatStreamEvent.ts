import { confirmationRecord } from '../../shared/api/chat-confirmations';
import { mergeConfirmationRecords, type ConfirmationRecord } from '../agentConfirmationUtils';
import { boundedTransparencyMetadata } from '../agentChatTransparency';
import { boundedTurnMetrics } from '../agentChatTiming';
import { isRecord, stringifyLooseValue } from '../agentChatMessageTypes';
import { readLiveChatMessages } from './liveConversationModel';
import { acceptStreamSequence } from './streamSequence';
import { selectedStreamModel, streamResponseMessage, streamRuntime } from './streamResponseMessage';
import type { ChatStreamState, StreamEventContext } from './streamEventModel';

/** One stream owns these envelope flags; React message updates remain scope-guarded. */
export function applyChatStreamEvent(state: ChatStreamState, value: unknown, context: StreamEventContext): void {
  if (!isRecord(value)) return;
  const sequence = acceptStreamSequence(value.sequence, state.sequence);
  if (!sequence.accepted) return;
  state.sequence = sequence.sequence;
  const { activeScopeRef, requestScope, setMessages, turnId } = context;
  const type = typeof value.type === 'string' ? value.type : '';
  if (type === 'stream_open') {
    state.streamId = stringifyLooseValue(value.stream_id || ''); context.activeStreamRef.current = state.streamId; return;
  }
  if (type === 'heartbeat') return;
  if (type === 'llm_selected') { state.model = selectedStreamModel(value); return; }
  if (type === 'agent_runtime') { context.setAgentRuntime(streamRuntime(value)); return; }
  if (type === 'phase' || type === 'progress') { context.setProcessingPhase(stringifyLooseValue(value.phase || 'routing')); return; }
  if (type === 'deadline') { context.setProcessingPhase('synthesis'); return; }
  if (type === 'turn_plan') {
    state.transparency = boundedTransparencyMetadata({ plan: value.plan, privacy: value.privacy, job: isRecord(value.job) && value.job.job_id ? value.job : null }); return;
  }
  if (type === 'turn_metrics') { state.metrics = boundedTurnMetrics(value); return; }
  if (type === 'done') { state.terminal = true; state.responseReceived ||= Boolean(value.has_response); return; }
  if (!['tool_start', 'tool_end', 'message', 'thought', 'error', 'confirmation_required'].includes(type)) return;
  if (['message', 'thought', 'error', 'confirmation_required'].includes(type)) state.responseReceived = true;
  const addAssistant = !state.assistantAdded;
  state.assistantAdded = true;
  if (type === 'confirmation_required') {
    const parsed = confirmationRecord(value);
    if (!parsed) throw new Error('Stream confirmation is missing its identifier');
    const confirmation = { ...parsed, status: 'pending', client_scope: requestScope, agent_id: context.agentId, session_id: context.sessionId };
    setMessages((previous) => {
      if (activeScopeRef.current !== requestScope) return previous;
      return readLiveChatMessages(mergeConfirmationRecords<ConfirmationRecord>(previous, [confirmation], () => context.confirmationSummary(confirmation)))
        .map((message) => message.confirmation?.confirmation_id === confirmation.confirmation_id ? { ...message, turnId } : message);
    });
    return;
  }
  setMessages((previous) => activeScopeRef.current === requestScope ? streamResponseMessage(previous, value, state, context, addAssistant) : previous);
}
