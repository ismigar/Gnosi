import type { TFunction } from 'i18next';
import { boundedTransparencyMetadata, isRetryableErrorCode } from '../model/agentChatTransparency';
import { isRecord, type LooseRecord } from '../model/agentChatMessageTypes';
import type { StoredChatMessage } from './sessionModel';
import { definedTransparency, type ChatStreamState, type StreamEventContext } from './streamEventModel';

function streamError(data: LooseRecord, t: TFunction): string {
  let content = typeof data.content === 'string' ? data.content.trim() : '';
  content ||= t('errors.unknown', 'Unknown error');
  if (data.code === 'agent_model_unavailable') content = t('chat.agent_model_unavailable', 'The selected agent model is unavailable. Configure the agent and try again.');
  else if (data.code === 'agent_turn_timeout') content = t('chat.turn_timeout', 'The response exceeded the 120-second processing limit. Please try again.');
  else if (data.code === 'agent_loop_exhausted') content = t('chat.agent_loop_exhausted', 'The agent repeated the same operation and stopped safely. Refine the request or try again.');
  if (content.includes('rate_limit_exceeded')) content = t('chat.rate_limit_message', "You've exceeded this agent model's quota. Try a different agent or wait a few minutes.");
  return `❌ ${t('chat.error_prefix', 'Error')}: ${content}`;
}

export function streamResponseMessage(previous: readonly StoredChatMessage[], data: LooseRecord, state: ChatStreamState, context: Pick<StreamEventContext, 'turnId' | 't'>, addAssistant: boolean): readonly StoredChatMessage[] {
  const { t, turnId } = context;
  const messages = [...previous];
  if (addAssistant) messages.push({ role: 'assistant', content: '', llm: state.model, turnId, ...definedTransparency(state.transparency) });
  const index = messages.length - 1;
  let message: StoredChatMessage = messages[index] ?? { content: '' };
  if (data.type === 'tool_start') {
    message = { ...message, content: t('chat.tool_start', '🛠️ *Calling tool: {{tool}}...*', { tool: data.tool }) };
  } else if (data.type === 'tool_end') {
    message = { ...message, content: data.awaiting_confirmation
      ? t('chat.tool_pending_confirmation', '🟡 *Tool {{tool}} is awaiting confirmation.*', { tool: data.tool })
      : t('chat.tool_end', '✅ *Tool {{tool}} finished.*', { tool: data.tool }) };
  } else if (data.type === 'message' || data.type === 'thought') {
    const metadata = boundedTransparencyMetadata({
      plan: data.plan || message.plan || state.transparency.plan,
      privacy: data.privacy || message.privacy || state.transparency.privacy,
      verification: data.verification, citations: data.citations, freshness: data.freshness, job: data.job,
      explanation: data.explanation, quality: data.quality, conflicts: data.conflicts, evidence_security: data.evidence_security,
    });
    message = { ...message, ...(typeof data.content === 'string' && data.content ? { content: data.content } : {}), ...definedTransparency(metadata) };
  } else if (data.type === 'error') {
    const errorCode = typeof data.code === 'string' && data.code ? data.code : 'agent_error';
    message = { ...message, content: streamError(data, t), errorCode,
      retryable: Boolean(data.retryable) || isRetryableErrorCode(errorCode),
      ...(data.recovery !== null && typeof data.recovery === 'object' ? { recovery: data.recovery } : {}),
    };
  }
  if (index >= 0) messages[index] = message;
  return messages;
}

/** Runtime configuration has an open payload; only fields consumed by status UI are refined. */
export function streamRuntime(data: LooseRecord) {
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item: unknown): item is string => typeof item === 'string') : undefined;
  return {
    ...data,
    active_skill_ids: strings(data.active_skill_ids), missing_skill_ids: strings(data.missing_skill_ids), unavailable_tool_ids: strings(data.unavailable_tool_ids),
    supports_tools: typeof data.supports_tools === 'boolean' ? data.supports_tools : null,
    tool_count: typeof data.tool_count === 'number' || typeof data.tool_count === 'string' ? data.tool_count : null,
  };
}

export function selectedStreamModel(data: LooseRecord) {
  const strategy = isRecord(data.strategy) ? data.strategy : null;
  return {
    mode: typeof data.mode === 'string' && data.mode ? data.mode : 'agent_default',
    provider: typeof data.provider === 'string' ? data.provider : undefined,
    model: typeof data.model === 'string' ? data.model : undefined,
    strategy: strategy ? { ...strategy, mode: typeof strategy.mode === 'string' ? strategy.mode : undefined } : undefined,
  };
}
