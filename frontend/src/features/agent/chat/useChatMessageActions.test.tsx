import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatMessageActions } from './useChatMessageActions';
import { useChatRewind } from './useChatRewind';
import { boundedJob } from '../model/agentChatTransparency';
import type { StoredChatMessage } from './sessionModel';
import type { recordChatFeedback, requestChatMessageJob, rewindChatSession } from '../../../shared/api/chat-message-actions';

const mocks = vi.hoisted(() => ({
  feedback: vi.fn<typeof recordChatFeedback>(), job: vi.fn<typeof requestChatMessageJob>(), rewind: vi.fn<typeof rewindChatSession>(),
  copy: vi.fn<(text: string) => Promise<void>>(), diagnostic: vi.fn(), toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  confirmation: vi.fn<(value: null) => void>(), details: vi.fn<(value: null) => void>(), pending: vi.fn<(value: null) => void>(),
}));
vi.mock('../../../shared/api/chat-message-actions', () => ({ recordChatFeedback: mocks.feedback, requestChatMessageJob: mocks.job, rewindChatSession: mocks.rewind }));
vi.mock('../../../shared/platform/clipboard', () => ({ writeClipboardText: mocks.copy }));
vi.mock('../../../lib/toast', () => ({ toast: mocks.toast }));
vi.mock('./chatDiagnostics', () => ({ logChatError: mocks.diagnostic }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback, i18n: { language: 'ca', resolvedLanguage: 'ca' } }) }));

const initial: readonly StoredChatMessage[] = [
  { role: 'user', content: 'First request', turnId: 'turn-1' },
  { role: 'assistant', content: 'First answer', turnId: 'turn-1' },
  { role: 'user', content: 'Second request\nsecond line', turnId: 'turn-2' },
  { role: 'assistant', content: 'Second answer', turnId: 'turn-2', job: boundedJob({ job_id: 'job', status: 'running', capabilities: { cancel: true } }) },
];
let history = { current: 0 };
function Harness({ loading = false, rewindIndex = 3, messages: supplied = initial }: { loading?: boolean; rewindIndex?: number | null; messages?: readonly StoredChatMessage[] }) {
  const [messages, setMessages] = useState(supplied);
  const [input, setInputValue] = useState(''); const [menu, setShowMentionMenu] = useState(true);
  const [rewinding, setIsRewinding] = useState(false); const inputRef = useRef<HTMLTextAreaElement>(null);
  const actions = useChatMessageActions({ messages, setMessages, agentName: 'Fixture', selectedAgentId: 'agent', sessionId: 'session', isLoading: loading, inputRef, setInputValue, setShowMentionMenu });
  const rewind = useChatRewind({ messages, selectedAgentId: 'agent', sessionId: 'session', notebookId: 'notebook', pendingRewindIndex: rewindIndex, isLoading: loading, isRewinding: rewinding, historyHydrationRef: history, setMessages, setPendingConfirmation: mocks.confirmation, setDetailsMessageIndex: mocks.details, setPendingRewindIndex: mocks.pending, setIsRewinding, focusComposerWith: actions.focusComposerWith });
  return <>
    <textarea ref={inputRef} value={input} onChange={(event) => { setInputValue(event.target.value); }} />
    <output data-messages>{JSON.stringify(messages)}</output><output data-menu>{String(menu)}</output><output data-rewinding>{String(rewinding)}</output>
    <button onClick={() => { void actions.copyMessage('Second answer'); }}>Copy</button>
    <button onClick={() => { actions.quoteMessage(messages[2]); }}>Quote user</button>
    <button onClick={() => { actions.quoteMessage(messages[3]); }}>Quote assistant</button>
    <button onClick={() => { actions.retryMessage(3); }}>Retry</button>
    <button onClick={() => { actions.markMessage(3, 'saved', true); }}>Save</button>
    <button onClick={() => { void actions.submitMessageFeedback(3, 'up'); }}>Helpful</button>
    <button onClick={() => { void actions.refreshMessageJob(3); }}>Status</button>
    <button onClick={() => { void actions.refreshMessageJob(3, 'cancel'); }}>Cancel job</button>
    <button onClick={() => { void rewind(); }}>Rewind</button>
  </>;
}
let container: HTMLDivElement; let root: Root;
beforeAll(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
beforeEach(() => {
  vi.resetAllMocks(); history = { current: 0 }; mocks.feedback.mockResolvedValue(undefined); mocks.copy.mockResolvedValue(undefined);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); vi.unstubAllGlobals(); });
async function render(props: Parameters<typeof Harness>[0] = {}): Promise<void> {
  await act(async () => { root.render(<Harness {...props} />); await Promise.resolve(); });
}
async function click(label: string): Promise<void> {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label); if (!button) throw new Error(`Missing ${label}`);
  await act(async () => { button.click(); await Promise.resolve(); });
}
function shownMessages(): unknown { return JSON.parse(container.querySelector('[data-messages]')?.textContent || '[]'); }

describe('message action lifecycle', () => {
  it('copies through the platform adapter and reports failures without backend diagnostics', async () => {
    await render(); await click('Copy'); expect(mocks.copy).toHaveBeenCalledExactlyOnceWith('Second answer');
    expect(mocks.toast.success).toHaveBeenCalledWith('Message copied');
    mocks.copy.mockRejectedValueOnce(new Error('denied')); await click('Copy');
    expect(mocks.toast.error).toHaveBeenCalledWith('Could not copy the message'); expect(mocks.diagnostic).toHaveBeenCalledTimes(1);
  });
  it('quotes multiline user and assistant messages and closes mentions', async () => {
    await render(); await click('Quote user');
    expect(container.querySelector('textarea')?.value).toBe('> You: Second request\n> second line\n\n');
    expect(container.querySelector('[data-menu]')?.textContent).toBe('false');
    await click('Quote assistant'); expect(container.querySelector('textarea')?.value).toBe('> Fixture: Second answer\n\n');
  });
  it('prefills retry without submitting and does nothing while loading', async () => {
    await render({ loading: true }); await click('Retry'); expect(container.querySelector('textarea')?.value).toBe('');
    await render(); await click('Retry'); expect(container.querySelector('textarea')?.value).toBe('Second request\nsecond line');
    expect(mocks.toast).toHaveBeenCalledTimes(1); expect(mocks.feedback).not.toHaveBeenCalled(); expect(mocks.job).not.toHaveBeenCalled();
  });
  it('marks only the requested message and toggles successful feedback to clear', async () => {
    await render(); await click('Save'); await click('Helpful');
    expect(shownMessages()).toMatchObject([{}, {}, {}, { saved: true, feedback: 'up' }]);
    expect(mocks.feedback.mock.calls[0]?.[0]).toMatchObject({ agent_id: 'agent', session_id: 'session', turn_id: 'turn-2', rating: 'up' });
    await click('Helpful'); expect(mocks.feedback.mock.calls[1]?.[0].rating).toBe('clear');
    expect(shownMessages()).toMatchObject([{}, {}, {}, { feedback: null }]);
  });
  it('restores the prior rating when feedback fails', async () => {
    mocks.feedback.mockRejectedValueOnce(new Error('offline')); await render({ messages: initial.map((message, index) => index === 3 ? { ...message, feedback: 'down' } : message) }); await click('Helpful');
    expect(shownMessages()).toMatchObject([{}, {}, {}, { feedback: 'down' }]); expect(mocks.toast.error).toHaveBeenCalledWith('Could not record response feedback.');
  });
  it('merges job refreshes while retaining capabilities omitted by the response', async () => {
    mocks.job.mockResolvedValueOnce({ status: 'completed' }).mockResolvedValueOnce({ status: 'cancelled' }); await render(); await click('Status');
    expect(mocks.job).toHaveBeenNthCalledWith(1, 'job', 'status'); expect(shownMessages()).toMatchObject([{}, {}, {}, { job: { status: 'completed', capabilities: { cancel: true } } }]);
    await click('Cancel job'); expect(mocks.job).toHaveBeenNthCalledWith(2, 'job', 'cancel');
  });
});

describe('conversation rewind lifecycle', () => {
  it('keeps the canonical prefix, clears review state and prefills without undoing external work', async () => {
    mocks.rewind.mockResolvedValue(initial.slice(0, 2)); await render(); await click('Rewind');
    expect(mocks.rewind).toHaveBeenCalledExactlyOnceWith({ agentId: 'agent', id: 'session' }, { before_turn_id: 'turn-2', keep_messages: 2 }, 'notebook');
    expect(shownMessages()).toHaveLength(2); expect(history.current).toBe(1);
    for (const callback of [mocks.confirmation, mocks.details, mocks.pending]) expect(callback).toHaveBeenCalledExactlyOnceWith(null);
    expect(container.querySelector('textarea')?.value).toBe('Second request\nsecond line');
    expect(mocks.toast.success).toHaveBeenCalledWith('Conversation rewound. Completed external actions were not reversed.');
  });
  it('keeps messages and review state after an API failure', async () => {
    mocks.rewind.mockRejectedValueOnce(new Error('offline')); await render(); await click('Rewind');
    expect(shownMessages()).toEqual(initial); expect(history.current).toBe(0); expect(mocks.confirmation).not.toHaveBeenCalled();
    expect(container.querySelector('[data-rewinding]')?.textContent).toBe('false'); expect(mocks.toast.error).toHaveBeenCalledWith('The conversation could not be rewound.');
  });
  it('does not rewind during loading or without a pending boundary', async () => {
    await render({ loading: true }); await click('Rewind'); await render({ rewindIndex: null }); await click('Rewind'); expect(mocks.rewind).not.toHaveBeenCalled();
  });
  it('rejects malformed turn identifiers without guessing a destructive boundary', async () => {
    await render({ messages: initial.map((message, index) => index === 2 ? { ...message, turnId: { unexpected: 'object' } } : message) }); await click('Rewind');
    expect(mocks.rewind).not.toHaveBeenCalled(); expect(shownMessages()).toHaveLength(4); expect(history.current).toBe(0);
    expect(mocks.toast.error).toHaveBeenCalledWith('The conversation could not be rewound.');
  });
});
