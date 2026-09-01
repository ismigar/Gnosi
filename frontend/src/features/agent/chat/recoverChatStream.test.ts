import { createInstance } from 'i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverChatStream } from './recoverChatStream';
import { createChatStreamState, lastTurnResponseIndex, type StreamEventContext } from './streamEventModel';
import type { StoredChatMessage } from './sessionModel';
import type { readChatStreamReplay } from '../../../shared/api/chat-streaming';

const replay = vi.hoisted(() => vi.fn<typeof readChatStreamReplay>());
vi.mock('../../../shared/api/chat-streaming', () => ({ readChatStreamReplay: replay }));
const locale = createInstance();
beforeAll(async () => { await locale.init({ lng: 'en', fallbackLng: 'en', resources: {}, interpolation: { escapeValue: false } }); });
beforeEach(() => { vi.resetAllMocks(); });
function fixture(initial: readonly StoredChatMessage[] = []) {
  let messages = initial;
  const state = createChatStreamState(); state.streamId = 'stream'; state.sequence = 2;
  const context: StreamEventContext = { t: locale.t, requestScope: 'scope', agentId: 'agent', sessionId: 'session', turnId: 'turn', activeScopeRef: { current: 'scope' }, activeStreamRef: { current: 'stream' }, setMessages: (update) => { messages = typeof update === 'function' ? update(messages) : update; }, setAgentRuntime: vi.fn(), setProcessingPhase: vi.fn(), confirmationSummary: () => '' };
  const pause = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  return { state, context, pause, messages: () => messages, recover: () => recoverChatStream(state, context, { pause }) };
}
describe('existing chat stream recovery', () => {
  it('updates the last response in the turn, retaining local presentation fields', async () => {
    const f = fixture([{ role: 'user', content: 'question', turnId: 'turn' }, { role: 'assistant', content: 'partial', turnId: 'turn', saved: true }]);
    replay.mockResolvedValueOnce([{ type: 'message', sequence: 3, content: 'Recovered 🧠', explanation: { evidence_count: 2 } }, { type: 'turn_metrics', sequence: 4, total_ms: 50 }, { type: 'done', sequence: 5 }]);
    await expect(f.recover()).resolves.toBe(true); expect(f.messages()).toHaveLength(2); expect(f.messages()[1]).toMatchObject({ content: 'Recovered 🧠', saved: true, explanation: { evidence_count: 2 } }); expect(f.state.metrics?.total_ms).toBe(50); expect(f.pause).not.toHaveBeenCalled();
    expect(replay).toHaveBeenCalledExactlyOnceWith({ streamId: 'stream', agentId: 'agent', sessionId: 'session' }, 2);
  });
  it('waits for a terminal event across polls and never duplicates a sequenced message', async () => {
    const f = fixture(); replay.mockResolvedValueOnce([{ type: 'message', sequence: 3, content: 'original' }]).mockResolvedValueOnce([{ type: 'message', sequence: 3, content: 'duplicate' }, { type: 'done', sequence: 4 }]);
    await expect(f.recover()).resolves.toBe(true); expect(f.pause).toHaveBeenCalledTimes(1); expect(f.messages()).toHaveLength(1); expect(f.messages()[0]?.content).toBe('original'); expect(replay.mock.calls[1]?.[1]).toBe(3);
  });
  it('does not call a terminal-only replay a recovered response', async () => {
    const f = fixture(); replay.mockResolvedValueOnce([{ type: 'done', sequence: 3 }]).mockResolvedValueOnce(null);
    await expect(f.recover()).resolves.toBe(false); expect(f.messages()).toEqual([]); expect(replay).toHaveBeenCalledTimes(2);
  });
  it('keeps confirmation replay read-only without executing or recreating the action', async () => {
    const f = fixture(); replay.mockResolvedValueOnce([{ type: 'confirmation_required', sequence: 3, confirmation_id: 'action' }]).mockResolvedValueOnce(null);
    await expect(f.recover()).resolves.toBe(false); expect(f.messages()).toEqual([]);
  });
  it('bounds polling at 120 attempts and one pause per unsuccessful attempt', async () => {
    const f = fixture(); replay.mockResolvedValue([]); await expect(f.recover()).resolves.toBe(false); expect(replay).toHaveBeenCalledTimes(120); expect(f.pause).toHaveBeenCalledTimes(120);
  });
  it('stops before another poll when the user changes conversation', async () => {
    const f = fixture(); replay.mockResolvedValue([]); f.pause.mockImplementation(() => { f.context.activeScopeRef.current = 'other'; return Promise.resolve(); });
    await expect(f.recover()).resolves.toBe(false); expect(replay).toHaveBeenCalledTimes(1); expect(f.messages()).toEqual([]);
  });
  it('never applies a response that arrives after the scope changes', async () => {
    const f = fixture([{ role: 'user', content: 'unchanged' }]);
    replay.mockImplementation(() => { f.context.activeScopeRef.current = 'other'; return Promise.resolve([{ type: 'message', sequence: 3, content: 'stale' }, { type: 'done', sequence: 4 }]); });
    await f.recover(); expect(f.messages()).toEqual([{ role: 'user', content: 'unchanged' }]);
  });
  it('preserves error presentation and propagates transport failure without another request', async () => {
    const f = fixture(); replay.mockResolvedValueOnce([{ type: 'error', sequence: 3, content: 'fixture failure' }, { type: 'done', sequence: 4 }]);
    await expect(f.recover()).resolves.toBe(true); expect(f.messages()[0]?.content).toBe('Error: fixture failure');
    replay.mockRejectedValueOnce(new Error('offline')); await expect(f.recover()).rejects.toThrow('offline'); expect(replay).toHaveBeenCalledTimes(2);
  });
  it('finds the last non-user message for a turn using the configured ES2022 baseline', () => {
    expect(lastTurnResponseIndex([], 'turn')).toBe(-1);
    expect(lastTurnResponseIndex([{ content: 'user', role: 'user', turnId: 'turn' }, { content: 'response', role: 'assistant', turnId: 'turn' }, { content: 'other', turnId: 'other' }], 'turn')).toBe(1);
  });
});
