import { afterEach, describe, expect, it, vi } from 'vitest';
import { queueCheckpointDeletion, retryCheckpointDeletions } from './checkpointQueue';
import { readChatStorage, removeChatStorage } from './chatPersistence';
import { parseStoredSessions } from './sessionRestore';
import type { deleteChatSessionCheckpoint } from '../../shared/api/chat-sessions';

const removeCheckpoint = vi.hoisted(() => vi.fn<typeof deleteChatSessionCheckpoint>());
vi.mock('../../shared/api/chat-sessions', () => ({ deleteChatSessionCheckpoint: removeCheckpoint }));
const key = 'checkpoint-queue-test';
afterEach(() => { removeChatStorage(key); vi.resetAllMocks(); });

describe('checkpoint cleanup queue', () => {
  it('deduplicates by both agent and session', () => {
    queueCheckpointDeletion(key, { agentId: 'one', id: 'same' });
    queueCheckpointDeletion(key, { agentId: 'one', id: 'same' });
    queueCheckpointDeletion(key, { agentId: 'two', id: 'same' });
    expect(parseStoredSessions(readChatStorage(key))).toEqual([{ agentId: 'one', id: 'same' }, { agentId: 'two', id: 'same' }]);
  });
  it('keeps only failed deletions for the next retry', async () => {
    queueCheckpointDeletion(key, { agentId: 'one', id: 'removed' });
    queueCheckpointDeletion(key, { agentId: 'one', id: 'retry' });
    removeCheckpoint.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('offline'));
    await retryCheckpointDeletions(key);
    expect(removeCheckpoint).toHaveBeenCalledTimes(2);
    expect(parseStoredSessions(readChatStorage(key))).toEqual([{ id: 'retry', agentId: 'one' }]);
  });
});
