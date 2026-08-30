import { deleteChatSessionCheckpoint, fetchChatSessionHistory } from '../../shared/api/chat-sessions';
import { logChatError as logError } from './chatDiagnostics';
import { createChatSession } from './sessionModel';
import { hydrateChatMessages } from './liveConversationModel';
import type { ChatSessionController } from './sessionControllerTypes';

export async function selectChatSession(context: ChatSessionController, nextId: string): Promise<void> {
  const { isLoading, chatSessions, historyHydrationRef, setAgentRuntime, setChatSessions, setSessionId, setMessages, setShowSessionsView, notebookId } = context;
  if (isLoading) return;
  const target = chatSessions.find((session) => session.id === nextId);
  if (!target) return;
  const hydrationId = historyHydrationRef.current + 1;
  historyHydrationRef.current = hydrationId;
  setAgentRuntime(null);
  setChatSessions((previous) => previous.map((session) => session.id === nextId ? { ...session, archived: false, updatedAt: Date.now() } : session));
  setSessionId(target.id);
  setMessages(target.messages);
  setShowSessionsView(false);
  try {
    const canonical = await fetchChatSessionHistory(target, notebookId);
    if (historyHydrationRef.current !== hydrationId) return;
    if (Array.isArray(canonical) && canonical.length) {
      const messages = hydrateChatMessages(canonical, target.messages);
      setMessages(messages);
      setChatSessions((previous) => previous.map((session) => session.id === target.id ? { ...session, messages } : session));
    }
  } catch (error) { logError('agent-chat-canonical-history', error); }
}

export function archiveChatSession(context: ChatSessionController): void {
  if (!context.sessionId) return;
  context.setChatSessions((previous) => previous.map((session) => session.id === context.sessionId ? { ...session, archived: true, updatedAt: Date.now() } : session));
}

export function createNewChatSession(context: ChatSessionController): void {
  if (context.isLoading) return;
  context.historyHydrationRef.current += 1;
  const next = createChatSession(context.defaultSessionTitle, context.selectedAgentId);
  context.setChatSessions((previous) => [next, ...previous.map((session) => session.id === context.sessionId ? { ...session, archived: true, updatedAt: Date.now() } : session)]);
  context.setSessionId(next.id);
  context.setMessages([]);
  context.setAgentRuntime(null);
  context.setInputValue('');
  context.clearDraftMentions();
  context.setShowSessionsView(false);
}

export async function deleteChatSession(context: ChatSessionController, targetId: string): Promise<void> {
  if (!targetId || context.isLoading) return;
  context.historyHydrationRef.current += 1;
  const target = context.chatSessions.find((session) => session.id === targetId);
  try { await deleteChatSessionCheckpoint(target); }
  catch (error) { logError('agent-chat-delete-checkpoint', error); return; }
  const remaining = context.chatSessions.filter((session) => session.id !== targetId);
  const remainingForAgent = remaining.filter((session) => session.agentId === context.selectedAgentId);
  const nextSession = remainingForAgent[0];
  if (!nextSession) {
    const fresh = createChatSession(context.defaultSessionTitle, context.selectedAgentId);
    context.setChatSessions([fresh, ...remaining]);
    context.setSessionId(fresh.id);
    context.setMessages([]);
    context.setInputValue('');
    context.clearDraftMentions();
    return;
  }
  context.setChatSessions(remaining);
  if (targetId === context.sessionId) {
    context.setSessionId(nextSession.id);
    context.setMessages(nextSession.messages);
  }
}
