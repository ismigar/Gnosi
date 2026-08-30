import { describe, expect, it } from 'vitest';
import { boundedTransparencyMetadata } from '../agentChatTransparency';
import { messageFeedback, previousPrompt } from './messageActionModel';

describe('message action model', () => {
  it('finds the nearest preceding nonempty user prompt without including the current message', () => {
    const messages = [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'answer' }, { role: 'user', content: '' }, { role: 'user', content: 'second' }];
    expect(previousPrompt(messages, 3)).toBe('first'); expect(previousPrompt(messages, 4)).toBe('second'); expect(previousPrompt(messages, 0)).toBe('');
  });
  it('rejects messages without a canonical assistant turn identifier', () => {
    expect(messageFeedback({ role: 'user', turnId: 'turn', content: 'private' }, 'a', 's', 'ca', 'up')).toBeNull();
    expect(messageFeedback({ role: 'assistant', content: 'private' }, 'a', 's', 'ca', 'up')).toBeNull();
  });
  it('uses plan metadata before explanation and keeps clear feedback and language bounds', () => {
    const message = { content: 'private', role: 'assistant', turnId: 'turn', errorCode: 'timeout', ...boundedTransparencyMetadata({
      plan: { mode: 'read', route: 'vault', execution: 'foreground', output_strategy: 'direct', domains: ['vault'], required_tool: 'search' },
      explanation: { mode: 'other', route: 'other' }, verification: { status: 'partial', limitations: ['missing'], tool_names: ['search'] },
    }) };
    const body = messageFeedback(message, 'a', 's', 'ca-LONG-LANGUAGE', null);
    expect(body).toMatchObject({ rating: 'clear', language: 'ca-LONG-', mode: 'read', route: 'vault', required_tool: 'search', limitations: ['missing'], tool_names: ['search'], error_code: 'timeout' });
    expect(body).not.toHaveProperty('content');
  });
});
