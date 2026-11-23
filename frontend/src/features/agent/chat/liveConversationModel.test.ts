import { describe, expect, it } from 'vitest';
import { hydrateChatMessages, readLiveChatMessages } from './liveConversationModel';

const checkpointPair = (turn_id: string) => [
  { role: 'user', content: 'Question', turn_id }, { role: 'assistant', content: 'Answer', turn_id },
];
const admissionFailure = (turnId: string) => [
  { role: 'user', content: 'Question', turnId },
  { role: 'assistant', content: 'Temporarily unavailable', turnId, errorCode: 'metadata_unavailable', retryable: true,
    timings: { model_calls: 0, model_ms: 0, setup_ms: 127, total_ms: 128, setup_breakdown_ms: { configuration: 127 } } },
];

describe('live conversation hydration boundary', () => {
  it('does not truncate live content or scrub a pending confirmation like the storage codec', () => {
    const content = 'long'.repeat(6000);
    const messages = readLiveChatMessages([{ role: 'assistant', content, confirmation: { confirmation_id: 'action', details: { body: 'review me' }, status: 'pending' }, plugin_field: 'preserved' }]);
    expect(messages[0]?.content).toBe(content);
    expect(messages[0]?.confirmation?.details).toEqual({ body: 'review me' });
    expect(messages[0]?.plugin_field).toBe('preserved');
  });
  it('merges canonical text with cached turn presentation metadata', () => {
    const cached = readLiveChatMessages([{ role: 'assistant', content: 'old', turnId: 'turn', saved: true, feedback: 'positive', processingMs: 2000 }]);
    const messages = hydrateChatMessages([{ role: 'assistant', content: 'canonical', turn_id: 'turn' }], cached);
    expect(messages[0]).toMatchObject({ content: 'canonical', saved: true, feedback: 'positive', processingMs: 2000 });
  });
  it('preserves the notebook cached conversation when the canonical response is empty', () => {
    const cached = readLiveChatMessages([{ role: 'user', content: 'retained' }]);
    expect(hydrateChatMessages([], cached, true)[0]?.content).toBe('retained');
    expect(hydrateChatMessages([], cached)).toEqual([]);
  });
  it('keeps admission failures in their original position on repeated history hydration', () => {
    const first = checkpointPair('first'), next = checkpointPair('next');
    const local = readLiveChatMessages([...admissionFailure('before'), ...first, ...admissionFailure('middle'),
      ...next, ...admissionFailure('after')]);
    for (const notebook of [false, true]) {
      const once = hydrateChatMessages([...first, ...next], local, notebook);
      const again = hydrateChatMessages([...first, ...next], once, notebook);
      expect(again.filter(row => row.role === 'assistant').map(row => row.turnId)).toEqual(['before','first','middle','next','after']);
      expect(again.filter(row => row.errorCode)).toHaveLength(3);
      expect(again.at(-1)).toMatchObject({ retryable: true, timings: { model_calls: 0, setup_breakdown_ms: { configuration: 127 } } });
      expect(again.filter(row => row.content === 'Answer').every(row => !row.timings && !row.errorCode)).toBe(true);
    }
  });
  it('uses a checkpointed retry and never revives failures from a rewound branch', () => {
    const first = checkpointPair('first'), retry = checkpointPair('retried');
    const cached = readLiveChatMessages([...first, ...admissionFailure('retried'), ...retry.map(row => ({ ...row, saved: true })),
      ...checkpointPair('removed'), ...admissionFailure('stale')]);
    const result = hydrateChatMessages([...first, ...retry], cached);
    expect(result.map(row => row.content)).toEqual([...first, ...retry].map(row => row.content));
    expect(result.at(-1)).toMatchObject({ content: 'Answer', saved: true });
    expect(result.some(row => row.errorCode || row.timings)).toBe(false);
  });
  it('places a failed turn after a unique older message without a turn identifier', () => {
    const older = [{ role: 'user', content: 'Old question' }, { role: 'assistant', content: 'Old answer' }];
    const result = hydrateChatMessages(older, readLiveChatMessages([...older, ...admissionFailure('recent')]));
    expect(result.map(row => row.content)).toEqual([...older, ...admissionFailure('recent')].map(row => row.content));
  });
  it('retains a known profile and model only for an explicit matching assistant turn, including repeated text', () => {
    const profile = { id: 'first', name: 'First assistant' };
    const cached = readLiveChatMessages([{ role: 'assistant', content: 'OK', turnId: 'one', assistant_profile: profile, llm: { model: 'one-model' } }]);
    const serverProfile = { id: 'archived', name: 'Archived assistant' };
    const rows = hydrateChatMessages([
      { role: 'assistant', content: 'OK', turn_id: 'different' },
      { role: 'assistant', content: 'OK', session_id: 'one' },
      { role: 'assistant', content: 'Current text', turn_id: 'one' },
      { role: 'assistant', content: 'Server answer', turn_id: 'one', assistant_profile: serverProfile },
      { role: 'assistant', content: 'Server ID only', turn_id: 'one', assistant_profile: { id: 'first' } },
    ], cached);
    expect(rows[0]?.turnId).toBe('different');
    expect(rows[0]?.assistant_profile).toBeUndefined(); expect(rows[0]?.llm).toBeUndefined();
    expect(rows[1]?.assistant_profile).toBeUndefined(); expect(rows[1]?.llm).toBeUndefined();
    expect(rows[2]).toMatchObject({ assistant_profile: profile, llm: { model: 'one-model' } });
    expect(rows[3]?.assistant_profile).toEqual(serverProfile); expect(rows[3]?.llm).toBeUndefined();
    expect(rows[4]?.assistant_profile).toEqual(profile);
  });
  it('does not convert an old session alias or a role-only match into author evidence on a later hydration', () => {
    const cached = readLiveChatMessages([{ role: 'assistant', content: 'cached', turnId: 'old' }]);
    for (const alias of [{ session_id: 'old' }, { turn_id: 'old', turn_id_is_legacy: true }, {}]) {
      const first = hydrateChatMessages([{ role: 'assistant', content: 'LEGACY', ...alias,
        assistant_profile: { id: 'legacy', name: 'Legacy author' }, llm: { model: 'legacy-model' } }], cached);
      const later = hydrateChatMessages([{ role: 'assistant', content: 'Different turn', turn_id: 'old' }], first);
      expect(later[0]?.assistant_profile).toBeUndefined(); expect(later[0]?.llm).toBeUndefined();
    }
  });
  it('does not guess between different cached assistant rows sharing a turn', () => {
    const cached = readLiveChatMessages(['one', 'two'].map(name => ({
      role: 'assistant', content: name, turnId: 'turn', assistant_profile: { id: name, name }, llm: { model: name },
    })));
    const rows = hydrateChatMessages(['one', 'new'].map(content => ({ role: 'assistant', turn_id: 'turn', content })), cached);
    expect(rows[0]).toMatchObject({ assistant_profile: { id: 'one' }, llm: { model: 'one' } });
    expect(rows[1]?.assistant_profile).toBeUndefined(); expect(rows[1]?.llm).toBeUndefined();
  });
});
