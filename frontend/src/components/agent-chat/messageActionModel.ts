import type { ChatFeedback } from '../../shared/api/chat-message-actions';
import { effectiveMessageTimingMs } from '../agentChatTiming';
import type { StoredChatMessage } from './sessionModel';

export type MessageRating = 'up' | 'down';
export interface MessageActionValues {
  readonly feedback: string | null;
  readonly saved: boolean;
  readonly job: StoredChatMessage['job'];
}

export function previousPrompt(messages: readonly StoredChatMessage[], index: number): string {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor];
    if (message?.role === 'user' && message.content) return message.content;
  }
  return '';
}

/** Only bounded operational metadata is sent, never the prompt, response or attachments. */
export function messageFeedback(message: StoredChatMessage, agentId: string, sessionId: string, language: string, rating: string | null): ChatFeedback | null {
  if (!message.turnId || typeof message.turnId !== 'string' || message.role !== 'assistant') return null;
  return {
    agent_id: agentId, session_id: sessionId, turn_id: message.turnId, rating: rating || 'clear', language: language.slice(0, 8),
    mode: message.plan?.mode || message.explanation?.mode || 'analysis', domains: message.plan?.domains || [],
    route: message.plan?.route || message.explanation?.route || 'General',
    execution: message.plan?.execution || message.explanation?.execution || 'foreground',
    output_strategy: message.plan?.output_strategy || message.explanation?.output_strategy || 'model_synthesis',
    required_tool: message.plan?.required_tool || '', verification_status: message.verification?.status || '',
    limitations: message.verification?.limitations || [], tool_names: message.verification?.tool_names || [],
    duration_ms: effectiveMessageTimingMs(message) || 0, error_code: typeof message.errorCode === 'string' ? message.errorCode : '',
  };
}
