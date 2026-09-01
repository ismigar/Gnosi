import { isRecord } from '../model/agentChatMessageTypes';
import { boundedChatSessions, createChatSession, type StoredChatSession } from './sessionModel';
import type { ChatSessionIdentity } from '../../../shared/api/chat-sessions';

export function checkpointIdentities(value: unknown): ChatSessionIdentity[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((item) => typeof item.id === 'string' && typeof item.agentId === 'string'
    ? [{ id: item.id, agentId: item.agentId }] : []);
}

export function parseStoredSessions(value: string | null): unknown {
  try { const parsed: unknown = JSON.parse(value || '[]'); return parsed; }
  catch { return []; }
}

export interface RestoreSessionOptions {
  readonly value: unknown;
  readonly defaultTitle: string;
  readonly agentId: string;
  readonly activeId: string | null;
  readonly legacyId: string | null;
  readonly forcedSessionId: string;
  readonly embedded: boolean;
}

export function restoreChatSessions(options: RestoreSessionOptions): { sessions: StoredChatSession[]; active: StoredChatSession; evicted: ChatSessionIdentity[] } {
  const { defaultTitle, agentId, activeId, legacyId, forcedSessionId, embedded } = options;
  let values = options.value;
  if (embedded && forcedSessionId) values = [createChatSession(defaultTitle, agentId, { randomId: () => forcedSessionId })];
  else if (!Array.isArray(values) || !values.length) values = [createChatSession(defaultTitle, agentId)];
  const retained = boundedChatSessions(values);
  const retainedIds = new Set(retained.map((session) => session.id));
  const evicted = checkpointIdentities(values).filter((session) => !retainedIds.has(session.id));
  const sessions = retained.map((session) => ({
    ...session, agentId: session.agentId || agentId,
    title: ['Nova conversa', 'New conversation', 'Nueva conversación', 'Nouvelle conversation'].includes(session.title) && !session.messages.length ? defaultTitle : session.title,
  }));
  const agentSessions = sessions.filter((session) => session.agentId === agentId);
  let first = agentSessions[0];
  if (!first) {
    first = createChatSession(defaultTitle, agentId);
    sessions.unshift(first);
    agentSessions.push(first);
  }
  const targetId = activeId || legacyId || first.id;
  const active = agentSessions.find((session) => session.id === targetId) || agentSessions.find((session) => !session.archived) || first;
  return { sessions, active, evicted };
}
