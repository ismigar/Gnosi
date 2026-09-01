import { vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { ChatTurnContext } from './chatTurnTypes';
import type { StoredChatMessage } from './sessionModel';

export function chatTurnFixture(t: TFunction, overrides: Partial<ChatTurnContext> = {}) {
  let messages: readonly StoredChatMessage[] = [];
  const input = document.createElement('textarea'); input.style.height = '120px';
  const context: ChatTurnContext = {
    t, browserStorageScope: 'scope', selectedAgentId: 'agent', sessionId: 'session',
    notebookId: '', contextRefs: [], inputValue: 'question', readOnly: false, isLoading: false,
    agentHasModel: true, selectedMentions: [], attachments: [],
    requestAbortRef: { current: null }, processingStartedAtRef: { current: null },
    inputRef: { current: input }, activeScopeRef: { current: 'scope:agent:session' },
    activeStreamRef: { current: '' }, setMessages: update => { messages = typeof update === 'function' ? update(messages) : update; },
    setAgentRuntime: vi.fn(), setProcessingPhase: vi.fn(), confirmationSummary: () => 'review',
    clearDraftMentions: vi.fn(), clearDraftAttachments: vi.fn(), setInputValue: vi.fn(),
    setShowMentionMenu: vi.fn(), setIsLoading: vi.fn(), ...overrides,
  };
  return { context, input, messages: () => messages };
}

export function streamResponse(records: readonly unknown[]): Response {
  return new Response(records.map(record => JSON.stringify(record)).join('\n') + '\n');
}

export function pendingResponse() {
  let resolve: (response: Response) => void = () => { throw new Error('Response promise not initialized'); };
  let reject: (reason: unknown) => void = () => { throw new Error('Response promise not initialized'); };
  const promise = new Promise<Response>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
