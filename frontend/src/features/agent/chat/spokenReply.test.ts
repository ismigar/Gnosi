import { expect, it } from 'vitest';
import { spokenReply } from './spokenReply';

it('keeps a legacy reply identity when unrelated messages are appended', () => {
  const messages = [{ role: 'assistant', content: 'Visible reply' }];
  const original = spokenReply(messages);
  expect(spokenReply([...messages, { role: 'system', content: 'Context update' }])).toEqual(original);
  expect(spokenReply([...messages, { role: 'user', content: 'Next question' }])).toEqual(original);
});
it('distinguishes identical replies in separate turns and preserves a streamed turn identity', () => {
  const first = { role: 'assistant', content: 'Yes', turnId: 'one' };
  expect(spokenReply([first]).key).not.toBe(spokenReply([first, { ...first, turnId: 'two' }]).key);
  expect(spokenReply([{ ...first, content: 'Y' }]).key).toBe(spokenReply([first]).key);
  expect(spokenReply([{ role: 'assistant', content: 'Yes' }]).key)
    .not.toBe(spokenReply([{ role: 'assistant', content: 'Yes' }, { role: 'assistant', content: 'Yes' }]).key);
});
