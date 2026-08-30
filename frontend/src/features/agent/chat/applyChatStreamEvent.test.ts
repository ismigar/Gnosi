import { createInstance } from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyChatStreamEvent } from './applyChatStreamEvent';
import { createChatStreamState, type StreamEventContext } from './streamEventModel';
import type { StoredChatMessage } from './sessionModel';

const locale = createInstance();
beforeAll(async () => { await locale.init({ lng: 'en', fallbackLng: 'en', resources: {}, interpolation: { escapeValue: false } }); });
function fixture(initial: readonly StoredChatMessage[] = []) {
  let messages = initial;
  const state = createChatStreamState();
  const context: StreamEventContext = {
    t: locale.t, requestScope: 'scope:agent:session', agentId: 'agent', sessionId: 'session', turnId: 'turn',
    activeScopeRef: { current: 'scope:agent:session' }, activeStreamRef: { current: '' },
    setMessages: (update) => { messages = typeof update === 'function' ? update(messages) : update; },
    setAgentRuntime: vi.fn(), setProcessingPhase: vi.fn(), confirmationSummary: () => 'Review action',
  };
  return { state, context, messages: () => messages, send: (value: unknown) => { applyChatStreamEvent(state, value, context); } };
}

describe('typed stream event processing', () => {
  it('processes envelope metadata without creating empty assistant bubbles', () => {
    const f = fixture();
    for (const event of [
      { type: 'stream_open', sequence: 1, stream_id: 'stream' },
      { type: 'heartbeat', sequence: 2 },
      { type: 'llm_selected', sequence: 3, provider: 'fixture', model: 'model', strategy: { mode: 'balanced', custom: true } },
      { type: 'turn_plan', sequence: 4, plan: { mode: 'read' }, privacy: { classification: 'private' } },
      { type: 'turn_metrics', sequence: 5, total_ms: 1200, input_tokens: 10 },
    ]) f.send(event);
    expect(f.messages()).toEqual([]); expect(f.context.activeStreamRef.current).toBe('stream');
    expect(f.state).toMatchObject({ sequence: 5, streamId: 'stream', model: { mode: 'agent_default', model: 'model', strategy: { mode: 'balanced', custom: true } }, metrics: { total_ms: 1200 }, transparency: { plan: { mode: 'read' }, privacy: { classification: 'private' } } });
    expect(f.state.responseReceived).toBe(false);
  });
  it('deduplicates numbered events and accepts legacy unnumbered responses', () => {
    const f = fixture(); f.send({ type: 'message', sequence: 4, content: 'first' }); f.send({ type: 'message', sequence: 4, content: 'duplicate' });
    f.send({ type: 'message', sequence: 3, content: 'old' }); expect(f.messages()).toHaveLength(1); expect(f.messages()[0]?.content).toBe('first');
    f.send({ type: 'thought', content: 'legacy' }); expect(f.messages()[0]?.content).toBe('legacy'); expect(f.state.sequence).toBe(4);
  });
  it('updates one response bubble through tool progress and retains fallback plan metadata', () => {
    const f = fixture([{ role: 'user', content: 'question', turnId: 'turn' }]);
    f.send({ type: 'turn_plan', plan: { mode: 'read' }, privacy: { classification: 'private' } });
    f.send({ type: 'tool_start', tool: 'search' }); expect(f.messages()[1]?.content).toContain('Calling tool: search');
    f.send({ type: 'tool_end', tool: 'search', awaiting_confirmation: true }); expect(f.messages()[1]?.content).toContain('awaiting confirmation');
    f.send({ type: 'tool_end', tool: 'search' }); expect(f.messages()[1]?.content).toContain('finished');
    f.send({ type: 'message', content: 'Answer 🧠', explanation: { mode: 'read', evidence_count: 2 }, verification: { status: 'verified' } });
    expect(f.messages()).toHaveLength(2); expect(f.messages()[1]).toMatchObject({ content: 'Answer 🧠', turnId: 'turn', plan: { mode: 'read' }, privacy: { classification: 'private' }, verification: { status: 'verified' }, explanation: { evidence_count: 2 } });
    expect(f.state.responseReceived).toBe(true);
  });
  it('keeps confirmations scoped, deduplicated and unsanitized for live review', () => {
    const f = fixture(); const action = { type: 'confirmation_required', confirmation_id: 'action', details: { body: 'Full review body', updates: [{ from: 'before', to: 'after' }] } };
    f.send(action); f.send({ ...action, details: { body: 'Updated review' } });
    expect(f.messages()).toHaveLength(1); expect(f.messages()[0]).toMatchObject({ role: 'assistant', content: 'Review action', turnId: 'turn', confirmation: { confirmation_id: 'action', status: 'pending', client_scope: 'scope:agent:session', agent_id: 'agent', session_id: 'session', details: { body: 'Updated review' } } });
    expect(action).not.toHaveProperty('client_scope');
  });
  it('ignores stale-scope message updates and rejects unidentified confirmations', () => {
    const initial = [{ role: 'user', content: 'other session' }]; const f = fixture(initial);
    f.context.activeScopeRef.current = 'other'; f.send({ type: 'message', content: 'stale' });
    f.send({ type: 'confirmation_required', confirmation_id: 'action' }); expect(f.messages()).toBe(initial);
    expect(() => { f.send({ type: 'confirmation_required', details: {} }); }).toThrow('missing its identifier'); expect(f.messages()).toBe(initial);
  });
  it.each([
    ['agent_model_unavailable', 'The selected agent model is unavailable.'],
    ['agent_turn_timeout', '120-second processing limit'],
    ['agent_loop_exhausted', 'stopped safely'],
    ['other', "You've exceeded this agent model's quota"],
  ])('localizes %s and retains retry metadata', (code, text) => {
    const f = fixture(); f.send({ type: 'error', code, content: code === 'other' ? 'rate_limit_exceeded' : 'raw', retryable: true, recovery: { action: 'retry_message', automatic: false } });
    expect(f.messages()[0]?.content).toContain(text); expect(f.messages()[0]).toMatchObject({ errorCode: code, retryable: true, recovery: { automatic: false } });
  });
  it('reports unknown streamed errors without rendering nontext payloads', () => {
    const f = fixture(); f.send({ type: 'error', content: { malformed: true } }); expect(f.messages()[0]?.content).toBe('❌ Error: Unknown error');
    f.send({ type: 'message', content: { malformed: true } }); expect(f.messages()[0]?.content).toBe('❌ Error: Unknown error');
  });
  it('keeps phase and runtime status updates separate from messages', () => {
    const f = fixture(); f.send({ type: 'phase', phase: 'tools' }); f.send({ type: 'progress', phase: 'model' }); f.send({ type: 'deadline' });
    expect(f.context.setProcessingPhase).toHaveBeenNthCalledWith(1, 'tools'); expect(f.context.setProcessingPhase).toHaveBeenNthCalledWith(2, 'model'); expect(f.context.setProcessingPhase).toHaveBeenNthCalledWith(3, 'synthesis');
    f.send({ type: 'agent_runtime', supports_tools: true, active_skill_ids: ['one', 2], tool_count: 3, custom: 'retained' });
    expect(f.context.setAgentRuntime).toHaveBeenCalledWith(expect.objectContaining({ supports_tools: true, active_skill_ids: ['one'], tool_count: 3, custom: 'retained' })); expect(f.messages()).toEqual([]);
  });
  it('distinguishes terminal envelopes from actual responses and ignores unknown packets', () => {
    const f = fixture(); f.send(null); f.send([]); f.send({ type: 'unknown', content: 'not a response' }); f.send({ type: 'done' });
    expect(f.state.terminal).toBe(true); expect(f.state.responseReceived).toBe(false); expect(f.messages()).toEqual([]);
    f.send({ type: 'done', has_response: true }); expect(f.state.responseReceived).toBe(true);
  });
});
