import { confirmationRecord } from '../../../shared/api/chat-confirmations';
import { isRecord, recordValue } from '../model/agentChatMessageTypes';
import type { AgentConfirmation } from './confirmationModel';
import type { MessageDetailsData } from './messageDetailsModel';
import type { StoredChatMessage } from './sessionModel';
import { selectedStreamModel } from './streamResponseMessage';

interface MessageAttachment { readonly name?: string; readonly url?: string }
interface MessageUndo { readonly available: boolean; readonly run?: () => unknown }
export interface ChatMessageView extends StoredChatMessage, MessageDetailsData {
  readonly confirmation?: AgentConfirmation;
  readonly attachments: readonly MessageAttachment[];
  readonly llm?: ReturnType<typeof selectedStreamModel>;
  readonly undo?: MessageUndo;
  readonly retryable: boolean;
  readonly saved: boolean;
  readonly feedback?: string;
  readonly author_user_id?: string;
  readonly errorCode?: string;
}

function attachmentViews(value: unknown): MessageAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: readonly unknown[] = value;
  return attachments.filter(isRecord).map(item => ({
    name: typeof item.name === 'string' ? item.name : undefined,
    url: typeof item.url === 'string' ? item.url : undefined,
  }));
}

function messageUndo(value: unknown): MessageUndo | undefined {
  if (!isRecord(value)) return undefined;
  const run: unknown = value.run;
  return {
    available: Boolean(value.available),
    // Plugin methods may depend on their receiver; decoding must not execute them.
    run: typeof run === 'function' ? (): unknown => Reflect.apply(run, value, []) : undefined,
  };
}

/** Refine presentation only: keep the complete live content and opaque metadata. */
export function messagePresentation(message: StoredChatMessage): ChatMessageView {
  const confirmation = confirmationRecord(message.confirmation);
  const clientScope = recordValue(message.confirmation, 'client_scope');
  return {
    ...message,
    confirmation: confirmation ? { ...confirmation, client_scope: typeof clientScope === 'string' ? clientScope : undefined } : undefined,
    llm: isRecord(message.llm) ? selectedStreamModel(message.llm) : undefined,
    attachments: attachmentViews(message.attachments),
    undo: messageUndo(message.undo),
    retryable: Boolean(message.retryable), saved: Boolean(message.saved),
    feedback: typeof message.feedback === 'string' ? message.feedback : undefined,
    author_user_id: typeof message.author_user_id === 'string' ? message.author_user_id : undefined,
    errorCode: typeof message.errorCode === 'string' ? message.errorCode : undefined,
  };
}
