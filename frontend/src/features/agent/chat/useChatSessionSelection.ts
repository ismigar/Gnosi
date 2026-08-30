import { useEffect } from 'react';
import { CHAT_SELECTED_AGENT_KEY, createChatSession, deriveSessionTitle } from './sessionModel';
import { writeChatStorage } from './chatPersistence';
import { archiveChatSession, createNewChatSession, deleteChatSession, selectChatSession } from './chatSessionActions';
import type { ChatSessionController } from './sessionControllerTypes';

export function useChatSessionSelection(context: ChatSessionController) {
  const { embedded, scopeReady, scopedStorageKey, selectedAgentId, historyHydrationRef, setAgentRuntime,
    chatSessions, sessionId, defaultSessionTitle, setChatSessions, setSessionId, setMessages, clearDraftMentions, clearDraftAttachments } = context;
  useEffect(() => {
    if (!scopeReady) return;
    writeChatStorage(scopedStorageKey(CHAT_SELECTED_AGENT_KEY), selectedAgentId);
    if (!embedded) historyHydrationRef.current += 1;
    setAgentRuntime(null);
  }, [embedded, historyHydrationRef, scopeReady, scopedStorageKey, selectedAgentId, setAgentRuntime]);

  useEffect(() => {
    if (!scopeReady || !selectedAgentId) return;
    const current = chatSessions.find((session) => session.id === sessionId);
    if (current?.agentId === selectedAgentId) return;
    const recent = chatSessions.filter((session) => session.agentId === selectedAgentId && !session.archived).sort((left, right) => right.updatedAt - left.updatedAt)[0];
    const target = recent ?? createChatSession(defaultSessionTitle, selectedAgentId);
    if (!recent) setChatSessions((previous) => [target, ...previous]);
    setSessionId(target.id);
    setMessages(target.messages);
    clearDraftMentions();
    clearDraftAttachments();
  }, [chatSessions, defaultSessionTitle, scopeReady, selectedAgentId, sessionId, setChatSessions, setSessionId, setMessages, clearDraftMentions, clearDraftAttachments]);

  return {
    selectSession: (id: string) => selectChatSession(context, id),
    archiveCurrentSession: () => { archiveChatSession(context); },
    createNewSession: () => { createNewChatSession(context); },
    deleteSessionById: (id: string) => deleteChatSession(context, id),
  };
}

export function useSessionMessageBinding(context: ChatSessionController): void {
  const { defaultSessionTitle, messages, scopeReady, sessionId, setChatSessions } = context;
  useEffect(() => {
    if (!scopeReady || !sessionId) return;
    setChatSessions((previous) => previous.map((session) => session.id === sessionId ? {
      ...session, messages, updatedAt: Date.now(), title: deriveSessionTitle(messages, session.title || defaultSessionTitle),
    } : session));
  }, [defaultSessionTitle, messages, scopeReady, sessionId, setChatSessions]);
}
