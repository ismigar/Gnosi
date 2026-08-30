import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import type { AgentRuntimeState } from '../agentRuntimeStatus';
import { boundedTransparencyMetadata } from '../agentChatTransparency';
import type { TurnMetrics } from '../agentChatTiming';
import type { StoredChatMessage } from './sessionModel';
import type { AgentConfirmation } from './confirmationModel';

export interface StreamSelectedModel {
  readonly mode: string;
  readonly provider?: string;
  readonly model?: string;
  readonly strategy?: Readonly<Record<string, unknown>> & { readonly mode?: string };
}
export interface ChatStreamState {
  sequence: number;
  streamId: string;
  model: StreamSelectedModel | null;
  metrics: TurnMetrics | null;
  transparency: ReturnType<typeof boundedTransparencyMetadata>;
  assistantAdded: boolean;
  terminal: boolean;
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
export function createChatStreamState(): ChatStreamState {
  return { sequence: 0, streamId: '', model: null, metrics: null, transparency: boundedTransparencyMetadata({}), assistantAdded: false, terminal: false, responseReceived: false };
}
export function definedTransparency(metadata: ChatStreamState['transparency']): Partial<ChatStreamState['transparency']> {
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== null));
}

export function lastTurnResponseIndex(messages: readonly StoredChatMessage[], turnId: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.turnId === turnId && message.role !== 'user') return index;
  }
  return -1;
}
