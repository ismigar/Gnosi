import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import type { StoredChatMessage } from './sessionModel';
import type { ConfirmationPayload, ConfirmationRequestScope } from '../../../shared/api/chat-confirmations';
import { confirmationScope, type AgentConfirmation } from './confirmationModel';

export type ConfirmationConversation = readonly StoredChatMessage[];
export interface ConfirmationControllerScope {
  readonly browserStorageScope: string;
  readonly selectedAgentId: string;
  readonly sessionId: string;
  readonly activeScopeRef: RefObject<string>;
  readonly setMessages: Dispatch<SetStateAction<ConfirmationConversation>>;
}
export interface ConfirmationActionContext extends ConfirmationControllerScope {
  readonly t: TFunction;
  readonly pendingConfirmation: AgentConfirmation | null;
  readonly setPendingConfirmation: Dispatch<SetStateAction<AgentConfirmation | null>>;
}

export function confirmationRequest(confirmation: AgentConfirmation, context: Pick<ConfirmationControllerScope, 'browserStorageScope' | 'selectedAgentId' | 'sessionId'>): { scope: ConfirmationRequestScope; requestScope: string } {
  const scope = { agent_id: confirmation.agent_id || context.selectedAgentId, session_id: confirmation.session_id || context.sessionId };
  return { scope, requestScope: confirmationScope(confirmation, context.browserStorageScope) || `${context.browserStorageScope}:${scope.agent_id}:${scope.session_id}` };
}

function legacyConfirmationId(message: StoredChatMessage, verified: ReadonlyMap<string, AgentConfirmation>): string | undefined {
  if (message.role !== 'assistant' || message.confirmation) return undefined;
  try {
    const value: unknown = JSON.parse(message.content);
    if (value && typeof value === 'object' && 'type' in value && value.type === 'confirmation_required'
      && 'confirmation_id' in value && typeof value.confirmation_id === 'string' && verified.has(value.confirmation_id)) return value.confirmation_id;
  } catch { /* Ordinary prose and truncated JSON remain ordinary messages. */ }
  return undefined;
}

/** Merge trusted live confirmation records without applying the bounded storage codec. */
export function mergeLiveConfirmationRecords(messages: ConfirmationConversation, records: readonly AgentConfirmation[], summary: (record: AgentConfirmation) => string): ConfirmationConversation {
  const byId = new Map(records.map(record => [record.confirmation_id, record]));
  const existingIds = new Map<string, number>();
  const updated: StoredChatMessage[] = [];
  for (const message of messages) {
    const id = message.confirmation?.confirmation_id || legacyConfirmationId(message, byId);
    if (!id) { updated.push(message); continue; }
    const current = byId.get(id);
    const next = current ? { ...message, content: summary(current), confirmation: { ...message.confirmation, ...current } } : message;
    const earlier = existingIds.get(id);
    if (earlier !== undefined) updated[earlier] = { ...next, ...updated[earlier] };
    else { existingIds.set(id, updated.length); updated.push(next); }
  }
  for (const record of records) {
    if (!existingIds.has(record.confirmation_id)) updated.push({ role: 'assistant', content: summary(record), confirmation: record });
  }
  return updated;
}

export function withConfirmationStatus(messages: ConfirmationConversation, confirmationId: string, status: string): ConfirmationConversation {
  const terminal = ['cancelled', 'completed', 'expired', 'failed', 'outcome_unknown', 'partial'].includes(status);
  return messages.map((message) => message.confirmation?.confirmation_id === confirmationId ? {
    ...message,
    confirmation: { ...message.confirmation, status, ...(terminal ? { details: {}, summary_key: 'chat.confirmations.summary', destructive: false } : {}) },
  } : message);
}

export function partialConfirmationMessage(payload: ConfirmationPayload | null, t: TFunction): string {
  const result = payload?.result ?? {};
  return t('chat.confirmations.partial', 'The action completed partially: {{completed}} completed, {{failed}} failed.', {
    completed: result.purged_count || result.updated_count || 0,
    failed: result.failed_count || (Array.isArray(result.rollback_failed_ids) ? result.rollback_failed_ids.length : 0) || 0,
  });
}

export function recoveredConfirmationMessage(status: string, payload: ConfirmationPayload | null, t: TFunction): string {
  if (status === 'completed') return t('chat.confirmations.completed', 'Action completed after confirmation.');
  if (status === 'partial') return partialConfirmationMessage(payload, t);
  if (status === 'outcome_unknown') return t('chat.confirmations.outcome_unknown', 'The connection was lost and the action outcome is unknown. Check the target before trying again.');
  return t(`chat.confirmations.status.${status}`, status);
}

export function localizedConfirmationError(payload: ConfirmationPayload, fallback: string, t: TFunction): string {
  const code = typeof payload.detail.code === 'string' ? payload.detail.code || payload.code : payload.code;
  return code ? t(`chat.confirmations.errors.${code}`, fallback) : fallback;
}
