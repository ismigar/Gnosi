import type { ConfirmationRecord } from '../agentConfirmationUtils';
import { isRecord, stringifyLooseValue } from '../agentChatMessageTypes';

export interface AgentConfirmation extends ConfirmationRecord {
  readonly client_scope?: string;
  readonly agent_id?: string;
  readonly session_id?: string;
  readonly title_key?: string;
  readonly status?: string;
  readonly destructive?: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

export function confirmationScope(confirmation: Partial<AgentConfirmation> | null | undefined, browserStorageScope = ''): string {
  if (confirmation?.client_scope) return confirmation.client_scope;
  if (confirmation?.agent_id && confirmation.session_id) {
    return [browserStorageScope, confirmation.agent_id, confirmation.session_id].filter(Boolean).join(':');
  }
  return '';
}

/** Preserve the existing readable review of JSON values and cyclic legacy objects. */
export function formatConfirmationValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '—';
  if (isRecord(value) || Array.isArray(value)) {
    try { return JSON.stringify(value, null, 2); }
    catch { return stringifyLooseValue(value); }
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
    || typeof value === 'symbol' || typeof value === 'function') return String(value);
  return '—';
}

export function confirmationDetailRecord(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}
