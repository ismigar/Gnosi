import { logError } from '../../../shared/notifications/notifyError';
import { defineStorageKey, readStorage, removeStorage, stringStorageCodec, writeStorage } from '../../../shared/platform/browser-storage';

export function scopedChatStorageKey(key: string, scope: string): string {
  return `${key}:${scope}`;
}

export function readChatStorage(key: string): string | null {
  return readStorage(defineStorageKey(key, stringStorageCodec)) ?? null;
}

export function writeChatStorage(key: string, value: string): boolean {
  const written = writeStorage(defineStorageKey(key, stringStorageCodec), value);
  if (!written) logError('chat.storage', new Error('Could not persist assistant chat state'));
  return written;
}

export function removeChatStorage(key: string): void {
  removeStorage(defineStorageKey(key, stringStorageCodec));
}
