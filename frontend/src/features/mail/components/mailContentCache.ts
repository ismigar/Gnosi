import type { MailViewerMessage } from './mailViewerTypes';


interface MailContentCacheOptions {
  readonly maxBytes?: number;
  readonly maxEntries?: number;
  readonly ttlMs?: number;
}


interface CacheEntry {
  readonly bytes: number;
  readonly expires: number;
  readonly message: MailViewerMessage;
}


/** A reader-owned LRU. Its caller clears it when the request context changes. */
export function createMailContentCache({
  maxBytes = 4 * 1024 * 1024,
  maxEntries = 16,
  ttlMs = 5 * 60 * 1000,
}: MailContentCacheOptions = {}) {
  const entries = new Map<string, CacheEntry>();
  let bytes = 0;
  const remove = (key: string): void => {
    const entry = entries.get(key);
    if (entry) bytes -= entry.bytes;
    entries.delete(key);
  };
  return {
    clear(): void { entries.clear(); bytes = 0; },
    delete: remove,
    get(key: string): MailViewerMessage | null {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expires <= Date.now()) { remove(key); return null; }
      entries.delete(key);
      entries.set(key, entry);
      return entry.message;
    },
    set(key: string, message: MailViewerMessage): void {
      remove(key);
      // Include metadata and attachment descriptors in the memory budget too.
      let size: number;
      try { size = (JSON.stringify(message).length + key.length) * 2; }
      catch { return; }
      if (size > maxBytes || maxEntries < 1) return;
      entries.set(key, { bytes: size, expires: Date.now() + ttlMs, message });
      bytes += size;
      while (entries.size > maxEntries || bytes > maxBytes) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        remove(oldest);
      }
    },
  };
}
