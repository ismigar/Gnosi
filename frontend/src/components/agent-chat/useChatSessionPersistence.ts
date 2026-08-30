import { useCallback, useEffect } from 'react';
import { deleteChatSessionCheckpoint, type ChatSessionIdentity } from '../../shared/api/chat-sessions';
import { logChatError as logError } from './chatDiagnostics';
import { CHAT_ACTIVE_SESSION_KEY, CHAT_PENDING_CHECKPOINT_DELETES_KEY, CHAT_SELECTED_AGENT_KEY, CHAT_SESSIONS_KEY, boundedChatSessions } from './sessionModel';
import { readChatStorage, removeChatStorage, writeChatStorage } from './chatPersistence';
import { parseStoredSessions, restoreChatSessions } from './sessionRestore';
import { queueCheckpointDeletion, retryCheckpointDeletions } from './checkpointQueue';
import type { ChatSessionController } from './sessionControllerTypes';

export function useChatSessionPersistence(context: ChatSessionController): void {
  const { browserStorageScope, defaultSessionTitle, embedded, forcedAgentId, forcedSessionId, scopedStorageKey,
    requestAbortRef, setPendingConfirmation, setSessionsHydrated, setHydratedStorageScope, setSelectedAgentId,
    setChatSessions, setMessages, setSessionId, scopeReady, chatSessions, sessionId, setAgentRuntime } = context;
  const evictCheckpoint = useCallback((session: ChatSessionIdentity) => {
    void deleteChatSessionCheckpoint(session).catch((error: unknown) => {
      queueCheckpointDeletion(scopedStorageKey(CHAT_PENDING_CHECKPOINT_DELETES_KEY), session);
      logError('agent-chat-evict-checkpoint', error);
    });
  }, [scopedStorageKey]);

  useEffect(() => {
    requestAbortRef.current?.abort();
    setPendingConfirmation(null);
    setSessionsHydrated(false);
    setHydratedStorageScope('');
    const agentId = forcedAgentId || readChatStorage(scopedStorageKey(CHAT_SELECTED_AGENT_KEY)) || 'gnosy';
    const restored = restoreChatSessions({
      value: parseStoredSessions(readChatStorage(scopedStorageKey(CHAT_SESSIONS_KEY))),
      defaultTitle: defaultSessionTitle, agentId,
      activeId: readChatStorage(scopedStorageKey(CHAT_ACTIVE_SESSION_KEY)),
      legacyId: readChatStorage(scopedStorageKey('agent_session_id_v2')),
      forcedSessionId, embedded,
    });
    restored.evicted.forEach(evictCheckpoint);
    setSelectedAgentId(agentId);
    removeChatStorage(scopedStorageKey('agent_selected_llm'));
    setChatSessions(restored.sessions);
    setMessages(restored.active.messages);
    setSessionId(restored.active.id);
    if (restored.active.id) {
      writeChatStorage(scopedStorageKey(CHAT_ACTIVE_SESSION_KEY), restored.active.id);
      writeChatStorage(scopedStorageKey('agent_session_id_v2'), restored.active.id);
    }
    setHydratedStorageScope(browserStorageScope);
    setSessionsHydrated(true);
  }, [browserStorageScope, defaultSessionTitle, embedded, forcedAgentId, forcedSessionId, evictCheckpoint, scopedStorageKey,
    requestAbortRef, setChatSessions, setHydratedStorageScope, setMessages, setPendingConfirmation, setSelectedAgentId, setSessionId, setSessionsHydrated]);

  useEffect(() => {
    if (!scopeReady) return;
    const retained = boundedChatSessions(chatSessions);
    const ids = new Set(retained.map((session) => session.id));
    const evicted = chatSessions.filter((session) => !ids.has(session.id));
    if (evicted.length) {
      evicted.forEach(evictCheckpoint);
      setChatSessions(retained);
      return;
    }
    writeChatStorage(scopedStorageKey(CHAT_SESSIONS_KEY), JSON.stringify(retained));
  }, [chatSessions, evictCheckpoint, scopeReady, scopedStorageKey, setChatSessions]);

  useEffect(() => {
    if (scopeReady) void retryCheckpointDeletions(scopedStorageKey(CHAT_PENDING_CHECKPOINT_DELETES_KEY));
  }, [scopeReady, scopedStorageKey]);

  useEffect(() => {
    if (!scopeReady || !sessionId) return;
    writeChatStorage(scopedStorageKey(CHAT_ACTIVE_SESSION_KEY), sessionId);
    writeChatStorage(scopedStorageKey('agent_session_id_v2'), sessionId);
    setAgentRuntime(null);
  }, [scopeReady, scopedStorageKey, sessionId, setAgentRuntime]);

}
