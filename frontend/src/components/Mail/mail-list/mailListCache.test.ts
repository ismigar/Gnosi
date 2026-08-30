import { describe, expect, it } from 'vitest';

import {
  defineStorageKey,
  listStorageKeyNames,
  readStorage,
  stringStorageCodec,
  writeStorage,
} from '../../../shared/platform/browser-storage';
import {
  purgeMailListCacheIds,
  readMailListCache,
  writeMailListCache,
} from './mailListCache';
import type { MailListMessage } from './mailListTypes';


class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}


function message(id: string, snippet = ''): MailListMessage {
  return {
    date: '2026-08-30T10:00:00Z',
    has_attachments: false,
    id,
    is_read: false,
    is_starred: false,
    sender: 'sender@example.com',
    snippet,
    subject: id,
    thread_id: id,
    timestamp: 1_777_546_800,
  };
}


describe('mail list cache', () => {
  it('round-trips fresh messages and expires them after the original TTL', () => {
    const storage = new MemoryStorage();
    const writtenAt = 10_000;

    expect(writeMailListCache('inbox', [message('one')], writtenAt, storage)).toBe(true);
    expect(readMailListCache('inbox', writtenAt + 1, storage)).toEqual([message('one')]);
    expect(readMailListCache('inbox', writtenAt + 86_400_000, storage)).toEqual([message('one')]);
    expect(readMailListCache('inbox', writtenAt + 86_400_001, storage)).toBeNull();
    expect(listStorageKeyNames('local', 'gnosi_mail_v1_', storage)).toEqual([]);
  });

  it('purges matching ids from every entry without renewing its timestamp', () => {
    const storage = new MemoryStorage();
    const writtenAt = 50_000;
    writeMailListCache('inbox', [message('one'), message('two')], writtenAt, storage);
    writeMailListCache('sent', [message('one'), message('three')], writtenAt, storage);

    purgeMailListCacheIds(['one'], storage);

    expect(readMailListCache('inbox', writtenAt + 1, storage)).toEqual([message('two')]);
    expect(readMailListCache('sent', writtenAt + 1, storage)).toEqual([message('three')]);
    expect(readMailListCache('inbox', writtenAt + 86_400_001, storage)).toBeNull();
  });

  it('rejects malformed and oversized entries safely', () => {
    const storage = new MemoryStorage();
    writeStorage(
      defineStorageKey('gnosi_mail_v1_bad', stringStorageCodec),
      '{"m":"invalid","ts":1}',
      storage,
    );

    expect(readMailListCache('bad', 2, storage)).toBeNull();
    expect(writeMailListCache(
      'large',
      [message('large', 'x'.repeat(600_000))],
      1,
      storage,
    )).toBe(false);
  });

  it('preserves unrelated keys and tolerates unavailable storage', () => {
    const storage = new MemoryStorage();
    const unrelated = defineStorageKey('mail-settings', stringStorageCodec);
    writeStorage(unrelated, 'keep', storage);
    writeMailListCache('inbox', [message('one')], 1, storage);
    purgeMailListCacheIds(['one'], storage);

    expect(readStorage(unrelated, storage)).toBe('keep');
    expect(readMailListCache('inbox', 2, storage)).toEqual([]);
    expect(readMailListCache('inbox', 2, null)).toBeNull();
    expect(writeMailListCache('inbox', [], 2, null)).toBe(false);
    expect(() => {
      purgeMailListCacheIds(['one'], null);
    }).not.toThrow();
  });

  it('does not propagate serialization failures to the mail UI', () => {
    const circular = message('circular');
    circular.extension = circular;

    expect(writeMailListCache('inbox', [circular], 1, new MemoryStorage())).toBe(false);
  });
});
