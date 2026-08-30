import {
  defineStorageKey,
  jsonStorageCodec,
  listStorageKeyNames,
  readStorage,
  removeStorage,
  writeStorage,
} from '../../../../shared/platform/browser-storage';
import type { MailListMessage } from './mailListTypes';


const MAIL_LIST_CACHE_PREFIX = 'gnosi_mail_v1_';
const MAIL_LIST_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
const MAIL_LIST_CACHE_MAX_PAYLOAD = 600_000;


interface StoredMailList {
  readonly m: MailListMessage[];
  readonly ts: number;
}


function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function isMailListMessage(value: unknown): value is MailListMessage {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.date === 'string'
    && typeof value.sender === 'string'
    && typeof value.subject === 'string'
    && typeof value.thread_id === 'string'
    && typeof value.timestamp === 'number'
    && typeof value.has_attachments === 'boolean'
    && typeof value.is_read === 'boolean'
    && typeof value.is_starred === 'boolean';
}


function isStoredMailList(value: unknown): value is StoredMailList {
  return isRecord(value)
    && typeof value.ts === 'number'
    && Array.isArray(value.m)
    && value.m.every(isMailListMessage);
}


const storedMailListCodec = jsonStorageCodec(isStoredMailList);


function cacheStorageKey(name: string) {
  return defineStorageKey(name, storedMailListCodec);
}


function cacheName(key: string): string {
  return `${MAIL_LIST_CACHE_PREFIX}${key}`;
}


export function readMailListCache(
  key: string,
  now = Date.now(),
  storage?: Storage | null,
): MailListMessage[] | null {
  const storageKey = cacheStorageKey(cacheName(key));
  const stored = readStorage(storageKey, storage);
  if (!stored) return null;
  if (now - stored.ts > MAIL_LIST_CACHE_MAX_AGE) {
    removeStorage(storageKey, storage);
    return null;
  }
  return stored.m;
}


export function writeMailListCache(
  key: string,
  messages: readonly MailListMessage[],
  now = Date.now(),
  storage?: Storage | null,
): boolean {
  try {
    const payload: StoredMailList = { m: [...messages], ts: now };
    if (storedMailListCodec.encode(payload).length > MAIL_LIST_CACHE_MAX_PAYLOAD) {
      return false;
    }
    return writeStorage(cacheStorageKey(cacheName(key)), payload, storage);
  } catch {
    return false;
  }
}


export function purgeMailListCacheIds(
  ids: readonly string[],
  storage?: Storage | null,
): void {
  const idSet = new Set(ids);
  listStorageKeyNames('local', MAIL_LIST_CACHE_PREFIX, storage).forEach((name) => {
    const key = cacheStorageKey(name);
    const stored = readStorage(key, storage);
    if (!stored) return;
    const messages = stored.m.filter((message) => !idSet.has(message.id));
    if (messages.length !== stored.m.length) {
      writeStorage(key, { m: messages, ts: stored.ts }, storage);
    }
  });
}
