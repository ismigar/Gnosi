import { afterEach, describe, expect, it, vi } from 'vitest';
import { logError } from '../../../lib/notifyError';
import { readChatStorage, removeChatStorage, scopedChatStorageKey, writeChatStorage } from './chatPersistence';

vi.mock('../../../lib/notifyError', () => ({ logError: vi.fn() }));
const keyA = scopedChatStorageKey('agent_chat_sessions_v2', 'test-vault-a:workspace:user');
const keyB = scopedChatStorageKey('agent_chat_sessions_v2', 'test-vault-b:workspace:user');

afterEach(() => {
  vi.restoreAllMocks();
  removeChatStorage(keyA);
  removeChatStorage(keyB);
  vi.clearAllMocks();
});

describe('chat scoped persistence adapter', () => {
  it('keeps exact legacy key names and isolates vault scopes', () => {
    expect(keyA).toBe('agent_chat_sessions_v2:test-vault-a:workspace:user');
    expect(writeChatStorage(keyA, 'history-a')).toBe(true);
    expect(writeChatStorage(keyB, 'history-b')).toBe(true);
    expect(readChatStorage(keyA)).toBe('history-a');
    expect(readChatStorage(keyB)).toBe('history-b');
    removeChatStorage(keyA);
    expect(readChatStorage(keyA)).toBeNull();
    expect(readChatStorage(keyB)).toBe('history-b');
  });

  it('reports unavailable persistence without throwing or exposing conversation contents', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(writeChatStorage(keyA, 'PRIVATE BODY')).toBe(false);
    expect(logError).toHaveBeenCalledWith('chat.storage', expect.any(Error));
    expect(JSON.stringify(vi.mocked(logError).mock.calls)).not.toContain('PRIVATE BODY');
  });

  it('tolerates blocked reads and removals', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readChatStorage(keyA)).toBeNull();
    expect(() => { removeChatStorage(keyA); }).not.toThrow();
  });
});
