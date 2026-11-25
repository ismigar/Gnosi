import type { boundedTransparencyMetadata } from '../model/agentChatTransparency';
import type { TurnMetrics } from '../model/agentChatTiming';

/** Presentation contract for already-decoded live and restored message metadata. */
export interface MessageDetailsData extends Partial<ReturnType<typeof boundedTransparencyMetadata>> {
  readonly role?: string;
  readonly llm?: { readonly model?: string; readonly strategy?: {
    readonly mode?: string;
    readonly decision?: { readonly engine?: string; readonly status?: string };
  } };
  readonly timings?: TurnMetrics | null;
  readonly errorCode?: string;
  readonly retryable?: boolean;
  readonly confirmation?: unknown;
  readonly attachments?: readonly unknown[];
}

export function hasMessageDetails(msg: MessageDetailsData): boolean {
  const plan = msg.plan;
  return Boolean(msg.timings || msg.llm?.model || msg.llm?.strategy?.mode || msg.llm?.strategy?.decision?.engine === 'jev'
    || msg.explanation || plan?.budgets || plan?.interpretation || plan?.capability_broker || plan?.deadline || plan?.memory?.checkpointed
    || msg.errorCode || msg.privacy || msg.verification || msg.quality || msg.gauntlet || msg.evidenceSecurity?.status === 'tainted'
    || msg.conflicts?.count || msg.freshness || msg.job || msg.confirmation || msg.attachments?.length);
}

export type MessageJobAction = 'resume' | 'cancel';
