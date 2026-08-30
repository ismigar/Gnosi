import { describe, expect, it } from 'vitest';
import { hydrateChatMessages, readLiveChatMessages } from './liveConversationModel';

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
});
