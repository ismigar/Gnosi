import { defineStorageKey, listStorageKeyNames, removeStorage, stringStorageCodec, writeStorage } from '../../../shared/platform/browser-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveQueuedPrompt, mutatePromptQueue, persistPromptQueue, queuedDraftStillCurrent, restorePromptQueue, type QueuedPrompt } from './promptQueue';
function clearQueues() {
  for (const name of listStorageKeyNames('local', 'agent_prompt_queue_v1:')) removeStorage(defineStorageKey(name, stringStorageCodec));
}
const entry = (id: string, status: QueuedPrompt['status'] = 'pending'): QueuedPrompt => ({ id, text: id, profileId: 'profile', status, mentions: [], attachments: [{ id: 'file', name: 'source.pdf', path: '/uploaded/source.pdf', url: null, size: 12, type: 'application/pdf' }] });
describe('durable prompt queue', () => {
  beforeEach(() => { clearQueues(); });
  it('keeps scopes and attachment identity separate and requires review on restore', () => {
    persistPromptQueue('vault:user:session1', [entry('a'), entry('b', 'sending')]);
    expect(restorePromptQueue('vault:user:session2')).toEqual([]);
    const restored = restorePromptQueue('vault:user:session1');
    expect(restored.map(item => item.status)).toEqual(['paused', 'uncertain']);
    expect(restored[0]?.attachments[0]?.path).toBe('/uploaded/source.pdf');
    expect(restored[1]?.id).toBe('b');
  });
  it('reorders pending turns without moving in-flight work', () => {
    const items = [entry('a', 'sending'), entry('b'), entry('c')];
    expect(moveQueuedPrompt(items, 'b', -1)).toEqual(items);
    expect(moveQueuedPrompt(items, 'c', -1).map(item => item.id)).toEqual(['a', 'c', 'b']);
  });
  it('ignores malformed queues', () => {
    writeStorage(defineStorageKey('agent_prompt_queue_v1:broken', stringStorageCodec), '[{"id":2}]');
    expect(restorePromptQueue('broken')).toEqual([]);
  });
});

it('serializes independent panel appends and edits without resurrecting completed turns', async () => {
  let tail = Promise.resolve();
  const locks = { request: vi.fn((_key: string, callback: () => unknown) => {
    const next = tail.then(callback);
    tail = next.then(() => {});
    return next;
  }) };
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
  clearQueues();
  await Promise.all([
    mutatePromptQueue('concurrent', current => [...current, entry('a')]),
    mutatePromptQueue('concurrent', current => [...current, entry('b')]),
  ]);
  await mutatePromptQueue('concurrent', current => current.map(item => item.id === 'a' ? { ...item, status: 'sending' } : item));
  await Promise.all([
    mutatePromptQueue('concurrent', current => current.filter(item => item.id !== 'a')),
    mutatePromptQueue('concurrent', current => current.map(item => item.id === 'b' ? { ...item, text: 'Edited' } : item)),
    mutatePromptQueue('concurrent', current => [...current, entry('c')]),
  ]);
  expect(restorePromptQueue('concurrent', false).map(item => [item.id, item.text])).toEqual([['b', 'Edited'], ['c', 'c']]);
});

it('keeps a new scope or edited composer draft after delayed enqueue persistence', () => {
  const captured = { inputValue: 'Original', attachments: [], selectedMentions: [] };
  expect(queuedDraftStillCurrent('session-a', 'session-b', captured, captured)).toBe(false);
  expect(queuedDraftStillCurrent('session-a', 'session-a', captured, { ...captured, inputValue: 'New draft' })).toBe(false);
  expect(queuedDraftStillCurrent('session-a', 'session-a', captured, { ...captured, attachments: [] })).toBe(false);
  expect(queuedDraftStillCurrent('session-a', 'session-a', captured, captured, 'Live edit before commit')).toBe(false);
  expect(queuedDraftStillCurrent('session-a', 'session-a', captured, captured, 'Original')).toBe(true);
});
