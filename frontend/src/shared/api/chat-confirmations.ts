import type { components } from '../../generated/openapi';
import { apiClient } from './client';

export type ConfirmationRequestScope = components['schemas']['ActionConfirmationRequest'];
export interface ChatConfirmation {
  readonly [key: string]: unknown;
  readonly confirmation_id: string;
  readonly agent_id?: string;
  readonly session_id?: string;
  readonly title_key?: string;
  readonly summary_key?: string;
  readonly status?: string;
  readonly destructive?: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}
export interface ConfirmationPayload {
  readonly status?: string;
  readonly code?: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly result: Readonly<Record<string, unknown>>;
}
export interface ConfirmationActionResponse {
  readonly ok: boolean;
  readonly statusText: string;
  readonly payload: ConfirmationPayload;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The legacy HTTP response is unconstrained in OpenAPI; refine it at this boundary. */
export function confirmationRecord(value: unknown): ChatConfirmation | null {
  if (!isRecord(value) || typeof value.confirmation_id !== 'string' || !value.confirmation_id) return null;
  const result: ChatConfirmation = {
    ...value,
    confirmation_id: value.confirmation_id,
    agent_id: typeof value.agent_id === 'string' ? value.agent_id : undefined,
    session_id: typeof value.session_id === 'string' ? value.session_id : undefined,
    title_key: typeof value.title_key === 'string' ? value.title_key : undefined,
    summary_key: typeof value.summary_key === 'string' ? value.summary_key : undefined,
    status: typeof value.status === 'string' ? value.status : undefined,
    destructive: typeof value.destructive === 'boolean' ? value.destructive : undefined,
    details: isRecord(value.details) ? value.details : undefined,
  };
  return result;
}

function payloadRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === 'string') {
    try { const parsed: unknown = JSON.parse(value); return isRecord(parsed) ? parsed : {}; }
    catch { return {}; }
  }
  return isRecord(value) ? value : {};
}

function confirmationPayload(value: unknown): ConfirmationPayload {
  const raw = payloadRecord(value);
  return {
    status: typeof raw.status === 'string' ? raw.status : undefined,
    code: typeof raw.code === 'string' ? raw.code : undefined,
    detail: isRecord(raw.detail) ? raw.detail : {},
    result: isRecord(raw.result) ? raw.result : {},
  };
}

export async function fetchChatConfirmations(scope: ConfirmationRequestScope, signal?: AbortSignal): Promise<ChatConfirmation[] | null> {
  const result = await apiClient.GET('/api/chat/confirmations', { params: { query: scope }, signal });
  if (!result.response.ok) return null;
  const raw = payloadRecord(result.data);
  if (!Array.isArray(raw.confirmations)) return [];
  const values: unknown[] = raw.confirmations;
  return values.flatMap((value) => { const record = confirmationRecord(value); return record ? [record] : []; });
}

export async function fetchChatConfirmationStatus(actionId: string, scope: ConfirmationRequestScope): Promise<ConfirmationPayload | null> {
  const result = await apiClient.GET('/api/chat/confirmations/{action_id}', {
    params: { path: { action_id: actionId }, query: scope },
  });
  return result.response.ok ? confirmationPayload(result.data) : null;
}

export async function confirmChatAction(actionId: string, scope: ConfirmationRequestScope): Promise<ConfirmationActionResponse> {
  // A successful legacy response with an empty/malformed JSON body still defaults
  // to completed. Reading text preserves that contract, distinct from a lost request.
  const result = await apiClient.POST('/api/chat/confirmations/{action_id}/confirm', {
    params: { path: { action_id: actionId } }, body: scope, parseAs: 'text',
  });
  return { ok: result.response.ok, statusText: result.response.statusText, payload: confirmationPayload(result.data ?? result.error) };
}

export async function cancelChatAction(actionId: string, scope: ConfirmationRequestScope): Promise<boolean> {
  const result = await apiClient.POST('/api/chat/confirmations/{action_id}/cancel', {
    params: { path: { action_id: actionId } }, body: scope, parseAs: 'text',
  });
  return result.response.ok;
}
