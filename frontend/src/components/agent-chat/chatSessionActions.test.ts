import { beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveChatSession, createNewChatSession, deleteChatSession, selectChatSession } from './chatSessionActions';
import { createChatSession, type StoredChatMessage, type StoredChatSession } from './sessionModel';
import type { ChatSessionController } from './sessionControllerTypes';
import type { deleteChatSessionCheckpoint, fetchChatSessionHistory } from '../../shared/api/chat-sessions';

const api = vi.hoisted(() => ({ remove: vi.fn<typeof deleteChatSessionCheckpoint>(), history: vi.fn<typeof fetchChatSessionHistory>() }));
vi.mock('../../shared/api/chat-sessions', () => ({ deleteChatSessionCheckpoint: api.remove, fetchChatSessionHistory: api.history }));
vi.mock('../../lib/notifyError', () => ({ logError: vi.fn(), notifyError: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); });

function setup(sessions = [createChatSession('One', 'agent', { randomId: () => 'one' }), createChatSession('Two', 'agent', { randomId: () => 'two' })]) {
  let currentSessions: StoredChatSession[] = sessions;
  let messages: readonly StoredChatMessage[] = [{ role: 'user', content: 'current' }];
  let sessionId = 'one';
  const context: ChatSessionController = {
    browserStorageScope: 'scope', defaultSessionTitle: 'New conversation', embedded: false, forcedAgentId: '', forcedSessionId: '',
    notebookId: '', isLoading: false, scopeReady: true, selectedAgentId: 'agent', sessionId, chatSessions: sessions, messages,
    scopedStorageKey: (key) => `${key}:scope`, requestAbortRef: { current: null }, historyHydrationRef: { current: 0 },
    setChatSessions: (update) => { currentSessions = typeof update === 'function' ? update(currentSessions) : update; },
    setMessages: (update) => { messages = typeof update === 'function' ? update(messages) : update; },
    setSessionId: (update) => { sessionId = typeof update === 'function' ? update(sessionId) : update; },
    setSelectedAgentId: vi.fn(), setSessionsHydrated: vi.fn(), setHydratedStorageScope: vi.fn(), setPendingConfirmation: vi.fn(),
    setAgentRuntime: vi.fn(), clearDraftMentions: vi.fn(), clearDraftAttachments: vi.fn(), setInputValue: vi.fn(), setShowSessionsView: vi.fn(),
  };
  return { context, sessions: () => currentSessions, messages: () => messages, sessionId: () => sessionId };
}

describe('session selection and deletion', () => {
  it('hydrates canonical history only for the latest selection', async () => {
    const state = setup();
    api.history.mockImplementation(() => {
      state.context.historyHydrationRef.current += 1;
      return Promise.resolve([{ role: 'assistant', content: 'stale' }]);
    });
    await selectChatSession(state.context, 'two');
    expect(state.sessionId()).toBe('two');
    expect(state.messages()).toEqual([]);
    expect(api.history).toHaveBeenCalledOnce();
    expect(state.context.setShowSessionsView).toHaveBeenCalledWith(false);
  });
  it('keeps cached presentation metadata on a canonical response', async () => {
    const session = { ...createChatSession('One', 'agent', { randomId: () => 'one' }), messages: [{ role: 'assistant', content: 'cached', turnId: 'turn', saved: true }] };
    const state = setup([session]);
    api.history.mockResolvedValue([{ role: 'assistant', content: 'canonical', turn_id: 'turn' }]);
    await selectChatSession(state.context, 'one');
    expect(state.messages()[0]).toMatchObject({ content: 'canonical', saved: true });
    expect(state.sessions()[0]?.messages[0]?.content).toBe('canonical');
  });
  it('does not remove local history if checkpoint deletion fails', async () => {
    const state = setup();
    api.remove.mockRejectedValue(new Error('offline'));
    await deleteChatSession(state.context, 'one');
    expect(state.sessions().map((session) => session.id)).toEqual(['one', 'two']);
    expect(state.sessionId()).toBe('one');
    expect(state.messages()[0]?.content).toBe('current');
  });
  it('selects another session only after successful checkpoint deletion', async () => {
    const state = setup();
    api.remove.mockResolvedValue(true);
    await deleteChatSession(state.context, 'one');
    expect(state.sessions().map((session) => session.id)).toEqual(['two']);
    expect(state.sessionId()).toBe('two');
  });
  it('creates an empty session when deleting the last one for the selected agent', async () => {
    const state = setup([createChatSession('One', 'agent', { randomId: () => 'one' }), createChatSession('Other', 'foreign', { randomId: () => 'foreign' })]);
    api.remove.mockResolvedValue(true);
    await deleteChatSession(state.context, 'one');
    expect(state.sessions()).toHaveLength(2);
    expect(state.sessions()[0]?.agentId).toBe('agent');
    expect(state.sessions()[1]?.id).toBe('foreign');
    expect(state.messages()).toEqual([]);
    expect(state.context.clearDraftMentions).toHaveBeenCalledOnce();
  });
  it('archives the current session and starts a new one without deleting history', () => {
    const state = setup();
    archiveChatSession(state.context);
    expect(state.sessions()[0]?.archived).toBe(true);
    createNewChatSession(state.context);
    expect(state.sessions()).toHaveLength(3);
    expect(state.sessions()[1]?.archived).toBe(true);
    expect(state.messages()).toEqual([]);
    expect(api.remove).not.toHaveBeenCalled();
  });
  it('does not change sessions during an active generation', async () => {
    const state = setup();
    const loading = { ...state.context, isLoading: true };
    await selectChatSession(loading, 'two');
    await deleteChatSession(loading, 'one');
    createNewChatSession(loading);
    expect(state.sessions()).toHaveLength(2);
    expect(state.sessionId()).toBe('one');
    expect(api.remove).not.toHaveBeenCalled();
    expect(api.history).not.toHaveBeenCalled();
  });
});
