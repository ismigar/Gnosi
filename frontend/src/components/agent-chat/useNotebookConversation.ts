import { useEffect } from 'react';
import { fetchNotebookConversation } from '../../shared/api/notebooks';
import { logChatError as logError } from './chatDiagnostics';
import { hydrateChatMessages } from './liveConversationModel';
import type { ChatSessionController } from './sessionControllerTypes';

export function useNotebookConversation(context: ChatSessionController): void {
  const { embedded, notebookId, scopeReady, forcedSessionId, forcedAgentId, isLoading,
    historyHydrationRef, setSessionId, setSelectedAgentId, setMessages, setChatSessions } = context;
  useEffect(() => {
    if (!embedded || !notebookId || !scopeReady || !forcedSessionId) return;
    let cancelled = false;
    const hydrationId = historyHydrationRef.current + 1;
    historyHydrationRef.current = hydrationId;
    setSessionId(forcedSessionId);
    if (forcedAgentId) setSelectedAgentId(forcedAgentId);
    const hydrate = () => {
      if (document.visibilityState !== 'visible' || isLoading) return;
      void fetchNotebookConversation(notebookId).then((canonical) => {
        if (cancelled || historyHydrationRef.current !== hydrationId) return;
        const canonicalMessages = Array.isArray(canonical.messages) ? canonical.messages : [];
        setMessages((previous) => hydrateChatMessages(canonicalMessages, previous, true));
        setChatSessions((previous) => previous.map((session) => session.id === forcedSessionId ? {
          ...session, agentId: forcedAgentId || session.agentId, messages: hydrateChatMessages(canonicalMessages, session.messages, true),
        } : session));
      }).catch((error: unknown) => { logError('agent-chat-notebook-history', error); });
    };
    hydrate();
    const timer = window.setInterval(hydrate, 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [embedded, forcedAgentId, forcedSessionId, historyHydrationRef, isLoading, notebookId, scopeReady,
    setChatSessions, setMessages, setSelectedAgentId, setSessionId]);
}
