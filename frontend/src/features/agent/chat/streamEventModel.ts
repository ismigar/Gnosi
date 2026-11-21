import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import type { AgentRuntimeState } from '../model/agentRuntimeStatus';
import { boundedTransparencyMetadata } from '../model/agentChatTransparency';
import type { TurnMetrics } from '../model/agentChatTiming';
import type { AssistantProfileSnapshot } from '../model/agentChatAuthor';
import type { StoredChatMessage } from './sessionModel';
import type { AgentConfirmation } from './confirmationModel';

export interface StreamSelectedModel {
  readonly mode: string;
  readonly provider?: string;
  readonly model?: string;
  readonly strategy?: Readonly<Record<string, unknown>> & {
    readonly mode?: string;
    readonly decision?: { readonly engine?: string; readonly status?: string };
  };
}
export interface ChatStreamState {
  sequence: number;
  streamId: string;
  model: StreamSelectedModel | null;
  assistantProfile?: AssistantProfileSnapshot;
  metrics: TurnMetrics | null;
  transparency: ReturnType<typeof boundedTransparencyMetadata>;
  terminal: boolean;
  failed: boolean;
  responseReceived: boolean;
}
export interface StreamEventContext {
  readonly t: TFunction;
  readonly requestScope: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly activeScopeRef: RefObject<string>;
  readonly activeStreamRef: RefObject<string>;
  readonly setMessages: Dispatch<SetStateAction<readonly StoredChatMessage[]>>;
  readonly setAgentRuntime: (runtime: AgentRuntimeState) => void;
  readonly setProcessingPhase: (phase: string) => void;
  readonly confirmationSummary: (confirmation: AgentConfirmation) => string;
}
export function createChatStreamState(assistantProfile?: AssistantProfileSnapshot): ChatStreamState {
  return { sequence: 0, streamId: '', model: null, assistantProfile, metrics: null, transparency: boundedTransparencyMetadata({}), terminal: false, failed: false, responseReceived: false };
}
export function definedTransparency(metadata: ChatStreamState['transparency']): Partial<ChatStreamState['transparency']> {
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== null));
}

export function lastTurnResponseIndex(messages: readonly StoredChatMessage[], turnId: string): number {
  let fallback = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.turnId !== turnId || message.role === 'user') continue;
    if (message.role === 'assistant' && !message.confirmation) return index;
    if (fallback < 0) fallback = index;
  }
  return fallback;
}
