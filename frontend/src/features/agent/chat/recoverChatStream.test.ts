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
    expect(replay).toHaveBeenCalledExactlyOnceWith({ streamId: 'stream', agentId: 'agent', sessionId: 'session' }, 2, undefined);
  });
  it('waits for a terminal event across polls and never duplicates a sequenced message', async () => {
    const f = fixture(); replay.mockResolvedValueOnce([{ type: 'message', sequence: 3, content: 'original' }]).mockResolvedValueOnce([{ type: 'message', sequence: 3, content: 'duplicate' }, { type: 'done', sequence: 4 }]);
    await expect(f.recover()).resolves.toBe(true); expect(f.pause).toHaveBeenCalledTimes(1); expect(f.messages()).toHaveLength(1); expect(f.messages()[0]?.content).toBe('original'); expect(replay.mock.calls[1]?.[1]).toBe(3);
  });
  it('updates a partial reply with the resolved author from its replay without retaining private profile settings', async () => {
    const f = fixture([{ role: 'assistant', turnId: 'turn', content: 'partial', assistant_profile: { id: 'selected', name: 'Selected' } }]);
    replay.mockResolvedValueOnce([
      { type: 'message', sequence: 3, content: 'Recovered reply',
        assistant_profile: { id: 'command', name: 'Command author', managed_by: 'plugin:sample', instructions: 'not public' } },
      { type: 'done', sequence: 4 },
    ]);
    await expect(f.recover()).resolves.toBe(true);
    expect(f.messages()[0]?.assistant_profile).toEqual({ id: 'command', name: 'Command author', managed_by: 'plugin:sample' });
  });
  it.each([
    { status: 'incomplete', rounds: 2, finding_count: 1, stop_reason: 'budget' },
    null,
    { status: 'unknown', rounds: 2, finding_count: 1, stop_reason: 'budget' },
  ])('replaces cached acceptance with the bounded recovered review: %j', async gauntlet => {
    const f = fixture([{ role: 'assistant', content: 'Old answer', turnId: 'turn',
      gauntlet: { status: 'accepted', rounds: 1, finding_count: 0, stop_reason: 'accepted' } }]);
    replay.mockResolvedValueOnce([{ type: 'message', sequence: 3, content: 'Recovered answer',
      gauntlet: gauntlet ? { ...gauntlet, findings: ['PRIVATE-REVIEW'] } : null }, { type: 'done', sequence: 4 }]);
    await expect(f.recover()).resolves.toBe(true);
    expect(f.messages()[0]?.gauntlet).toEqual(gauntlet?.status === 'incomplete' ? gauntlet : null);
    expect(JSON.stringify(f.messages())).not.toContain('PRIVATE-REVIEW');
  });
  it('finishes a live response when only its statistics and terminal event need replay', async () => {
    const f = fixture([{ role: 'assistant', content: 'Hola!', turnId: 'turn' }]);
    f.state.responseReceived = true;
    replay.mockResolvedValueOnce([{ type: 'turn_metrics', sequence: 3, response_ms: 25, total_ms: 87 }, { type: 'done', sequence: 4 }]);
    await expect(f.recover()).resolves.toBe(true);
    expect(f.state.metrics).toMatchObject({ response_ms: 25, total_ms: 87 });
    expect(f.messages()).toHaveLength(1); expect(f.pause).not.toHaveBeenCalled();
  });
  it('does not call a terminal-only replay a recovered response', async () => {
    const f = fixture(); replay.mockResolvedValueOnce([{ type: 'done', sequence: 3 }]).mockResolvedValueOnce(null);
    await expect(f.recover()).resolves.toBe(false); expect(f.messages()).toEqual([]); expect(replay).toHaveBeenCalledTimes(2);
  });
  it('keeps confirmation replay read-only without executing or recreating the action', async () => {
    const f = fixture(); replay.mockResolvedValueOnce([{ type: 'confirmation_required', sequence: 3, confirmation_id: 'action' }]).mockResolvedValueOnce(null);
    await expect(f.recover()).resolves.toBe(false); expect(f.messages()).toEqual([]);
  });
  it('finishes a confirmation-only replay without reopening a resolved action or polling again', async () => {
    const card = { role: 'assistant', turnId: 'turn', content: 'Completed', confirmation: { confirmation_id: 'action', status: 'completed' } };
    const f = fixture([card]);
    replay.mockResolvedValueOnce([{ type: 'confirmation_required', sequence: 3, confirmation_id: 'action' }, { type: 'done', sequence: 4 }]);
    await expect(f.recover()).resolves.toBe(true);
    expect(f.messages()).toEqual([card]);
    expect(f.state.failed).toBe(true);
    expect(f.pause).not.toHaveBeenCalled();
  });
  it('restores the existing confirmation author by ID while preserving its current status', async () => {
    const card = { role: 'assistant', content: 'Completed', confirmation: { confirmation_id: 'action', status: 'completed' } };
    const f = fixture([card]);
    replay.mockResolvedValueOnce([{ type: 'confirmation_required', sequence: 3, confirmation_id: 'action',
      assistant_profile: { id: 'real', name: 'Original author' } }, { type: 'done', sequence: 4 }]);
    await expect(f.recover()).resolves.toBe(true);
    expect(f.messages()).toEqual([{ ...card, assistant_profile: { id: 'real', name: 'Original author' } }]);
  });
  it('drops replay data that arrives after explicit Cancel in the same conversation', async () => {
    const f = fixture();
    const controller = new AbortController();
    replay.mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve([{ type: 'message', content: 'Cancelled answer', sequence: 3 }, { type: 'done', sequence: 4 }]);
    });
    await expect(recoverChatStream(f.state, f.context, { pause: f.pause, signal: controller.signal })).resolves.toBe(false);
    expect(f.messages()).toEqual([]);
    expect(f.pause).not.toHaveBeenCalled();
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
    await expect(f.recover()).resolves.toBe(true); expect(f.messages()[0]?.content).toBe('❌ Error: fixture failure');
    replay.mockRejectedValueOnce(new Error('offline')); await expect(f.recover()).rejects.toThrow('offline'); expect(replay).toHaveBeenCalledTimes(2);
  });
  it('keeps retry controls, confirmation status and later messages on their original turns', async () => {
    const card = { role: 'assistant', turnId: 'turn', content: 'Action completed', confirmation: { confirmation_id: 'action', status: 'completed' } };
    const later = { role: 'user', content: 'Next prompt', turnId: 'later' };
    const f = fixture([{ role: 'user', turnId: 'turn', content: 'Question' }, card, later]);
    const recovery = { retryable: true, automatic: false, action: 'retry_message', max_attempts: 1 };
    replay.mockResolvedValueOnce([
      { type: 'confirmation_required', confirmation_id: 'action', sequence: 3 },
      { type: 'error', code: 'agent_turn_timeout', content: 'Fixture timeout', content_language: 'en', recovery, sequence: 4 },
      { type: 'done', sequence: 5 },
    ]);
    await expect(f.recover()).resolves.toBe(true);
    expect(f.messages()).toHaveLength(4);
    expect(f.messages()[1]).toBe(card);
    expect(f.messages()[2]).toMatchObject({ turnId: 'turn', errorCode: 'agent_turn_timeout', retryable: true, content: '❌ Error: Fixture timeout', recovery });
    expect(f.messages()[3]).toBe(later);
    expect(f.state.failed).toBe(true);
  });
  it('retains bounded memory provenance across partial responses in the same replay batch', async () => {
    const f = fixture();
    const memory = { memory_id: 'memory', agent_id: 'agent', text: 'Prefer short answers', revision: 3 };
    replay.mockResolvedValueOnce([
      { type: 'message', sequence: 3, content: 'Partial', memory_provenance: [{ ...memory, unexpected: 'private' }] },
      { type: 'message', sequence: 4, content: 'Complete answer' },
      { type: 'done', sequence: 5 },
    ]);
    await expect(f.recover()).resolves.toBe(true);
    expect(f.messages()).toHaveLength(1);
    expect(f.messages()[0]).toMatchObject({ turnId: 'turn', content: 'Complete answer', memory_provenance: [memory] });
    expect(JSON.stringify(f.messages())).not.toContain('private');
  });
  it('finds the last non-user message for a turn using the configured ES2022 baseline', () => {
    expect(lastTurnResponseIndex([], 'turn')).toBe(-1);
    expect(lastTurnResponseIndex([{ content: 'user', role: 'user', turnId: 'turn' }, { content: 'response', role: 'assistant', turnId: 'turn' }, { content: 'other', turnId: 'other' }], 'turn')).toBe(1);
  });
});
