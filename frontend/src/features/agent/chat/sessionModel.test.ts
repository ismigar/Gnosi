import { describe, expect, it } from 'vitest';
import { boundedChatSessions, createChatSession, deriveSessionTitle } from './sessionModel';

describe('agent chat session persistence model', () => {
  it('retains the 20 most recently updated sessions and preserves unknown historical fields', () => {
    const input = Array.from({ length: 22 }, (_, index) => ({ id: `s${String(index)}`, updatedAt: index, title: 'History', plugin: { color: 'blue' }, agentId: 'agent', messages: [] }));
    const result = boundedChatSessions(input);
    expect(result).toHaveLength(20);
    expect(result[0]).toMatchObject({ id: 's21', plugin: { color: 'blue' }, agentId: 'agent' });
    expect(result.at(-1)?.id).toBe('s2');
    expect(input[0]?.id).toBe('s0');
  });

  it('retains 100 recent messages and bounds message content to 20000 characters', () => {
    const messages = Array.from({ length: 102 }, (_, index) => ({ role: 'user', content: 'x'.repeat(20_100), turnId: `t${String(index)}` }));
    const result = boundedChatSessions([{ id: 's', messages }]);
    expect(result[0]?.messages).toHaveLength(100);
    expect(result[0]?.messages[0]).toMatchObject({ turnId: 't2', content: 'x'.repeat(20_000) });
  });

  it('scrubs governed action text and details while keeping reconciliation identity', () => {
    const result = boundedChatSessions([{ id: 's', messages: [{ role: 'assistant', content: 'PRIVATE BODY', confirmation: {
      confirmation_id: 'c', status: 'pending', agent_id: 'agent', session_id: 's', details: { body: 'PRIVATE BODY' },
    } }] }]);
    expect(result[0]?.messages[0]).toMatchObject({ content: '', confirmation: {
      confirmation_id: 'c', status: 'pending', agent_id: 'agent', session_id: 's', details: {}, summary_key: 'chat.confirmations.summary',
    } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE BODY');
  });

  it('retains bounded transparency and presentation metadata', () => {
    const result = boundedChatSessions([{ id: 's', messages: [{ role: 'assistant', content: 'Answer', turnId: 'turn', saved: true, feedback: 'up',
      processingMs: 123, timings: { total_ms: 120 }, plan: { mode: 'analysis' }, citations: { sources: [], claims: [] },
    }] }]);
    expect(result[0]?.messages[0]).toMatchObject({ turnId: 'turn', saved: true, feedback: 'up', processingMs: 123, timings: { total_ms: 120 }, plan: { mode: 'analysis' } });
  });

  it('handles malformed storage without mutating it', () => {
    expect(boundedChatSessions({ sessions: [] })).toEqual([]);
    expect(boundedChatSessions([null, 'bad', {}, { id: 'valid', messages: null }])).toMatchObject([{ id: 'valid', messages: [] }]);
  });

  it('creates the legacy session shape with injectable identity and clock', () => {
    expect(createChatSession('New', 'agent', { now: () => 42, randomId: () => 'uuid' })).toEqual({
      id: 'uuid', title: 'New', archived: false, agentId: 'agent', messages: [], createdAt: 42, updatedAt: 42,
    });
  });

  it('derives titles from the first user turn with the existing mention and truncation rules', () => {
    expect(deriveSessionTitle([{ role: 'assistant', content: 'Ignore' }, { role: 'user', content: '@[Source](id) Explain this' }], 'New')).toBe('Explain this');
    expect(deriveSessionTitle([{ role: 'user', content: 'a'.repeat(50) }], 'New')).toBe('a'.repeat(42) + '...');
    expect(deriveSessionTitle([], 'New')).toBe('New');
  });
});
