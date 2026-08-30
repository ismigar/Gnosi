import { confirmationForStorage, type ConfirmationRecord } from '../model/agentConfirmationUtils';
import { boundedProcessingMs, boundedTransparencyMetadata, boundedTurnMetrics } from '../model/agentChatMessageUtils';
import { isRecord, stringifyLooseValue, type LooseRecord } from '../model/agentChatMessageTypes';
import type { TurnMetrics } from '../model/agentChatTiming';

export const CHAT_SESSIONS_KEY = 'agent_chat_sessions_v2';
export const CHAT_ACTIVE_SESSION_KEY = 'agent_chat_active_session_id_v2';
export const CHAT_SELECTED_AGENT_KEY = 'agent_selected_id_v2';
export const CHAT_PENDING_CHECKPOINT_DELETES_KEY = 'agent_pending_checkpoint_deletes_v1';
export const MAX_STORED_SESSIONS = 20;
export const MAX_STORED_MESSAGES = 100;
export const MAX_STORED_MESSAGE_CHARS = 20_000;

export interface StoredChatMessage extends Partial<ReturnType<typeof boundedTransparencyMetadata>> {
  readonly [key: string]: unknown;
  readonly content: string;
  readonly role?: string;
  readonly confirmation?: ConfirmationRecord;
  readonly processingMs?: number | null;
  readonly timings?: TurnMetrics | null;
}

export interface StoredChatSession {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly title: string;
  readonly archived: boolean;
  readonly agentId: string;
  readonly messages: readonly StoredChatMessage[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

function storedConfirmation(value: unknown): ConfirmationRecord | undefined {
  if (!isRecord(value) || typeof value.confirmation_id !== 'string') return undefined;
  return confirmationForStorage({ ...value, confirmation_id: value.confirmation_id });
}

function storedMessage(value: unknown): StoredChatMessage {
  const message = isRecord(value) ? value : {};
  return {
    ...message,
    role: typeof message.role === 'string' ? message.role : undefined,
    content: message.confirmation ? '' : stringifyLooseValue(message.content || '').slice(0, MAX_STORED_MESSAGE_CHARS),
    confirmation: storedConfirmation(message.confirmation),
    processingMs: boundedProcessingMs(message.processingMs),
    timings: boundedTurnMetrics(message.timings),
    ...boundedTransparencyMetadata(message),
  };
}

function timestamp(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isIdentifiedSession(value: unknown): value is LooseRecord & { id: string } {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0;
}

/** Preserve valid historical fields while bounding retention and scrubbing confirmation details. */
export function boundedChatSessions(input: unknown): StoredChatSession[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isIdentifiedSession)
    .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))
    .slice(0, MAX_STORED_SESSIONS)
    .map((session) => ({
      ...session,
      id: session.id,
      title: typeof session.title === 'string' ? session.title : '',
      archived: Boolean(session.archived),
      agentId: typeof session.agentId === 'string' ? session.agentId : '',
      createdAt: timestamp(session.createdAt),
      updatedAt: timestamp(session.updatedAt),
      messages: Array.isArray(session.messages)
        ? session.messages.slice(-MAX_STORED_MESSAGES).map(storedMessage)
        : [],
    }));
}

interface SessionRuntime {
  readonly now?: () => number;
  readonly randomId?: () => string;
}

export function createChatSession(title: string, agentId = 'gnosy', runtime: SessionRuntime = {}): StoredChatSession {
  const now = runtime.now ?? Date.now;
  return {
    id: runtime.randomId?.() ?? crypto.randomUUID(), title, archived: false, agentId,
    messages: [], createdAt: now(), updatedAt: now(),
  };
}

export function deriveSessionTitle(messages: unknown, fallback: string): string {
  if (!Array.isArray(messages)) return fallback;
  const firstUser = messages.filter(isRecord).find((message) => message.role === 'user' && stringifyLooseValue(message.content || '').trim());
  if (!firstUser) return fallback;
  const clean = stringifyLooseValue(firstUser.content).replace(/@\[[^\]]+\]\([^)]+\)/g, '').trim();
  return clean ? clean.length > 42 ? `${clean.slice(0, 42)}...` : clean : fallback;
}
