import type { boundedTransparencyMetadata } from '../model/agentChatTransparency';
import type { TurnMetrics } from '../model/agentChatTiming';

/** Presentation contract for already-decoded live and restored message metadata. */
export interface MessageDetailsData extends Partial<ReturnType<typeof boundedTransparencyMetadata>> {
  readonly role?: string;
  readonly llm?: { readonly model?: string; readonly strategy?: { readonly mode?: string } };
  readonly timings?: TurnMetrics | null;
  readonly errorCode?: string;
  readonly retryable?: boolean;
  readonly confirmation?: unknown;
  readonly attachments?: readonly unknown[];
}

export type MessageJobAction = 'resume' | 'cancel';
