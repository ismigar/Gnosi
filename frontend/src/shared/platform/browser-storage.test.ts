import { describe, expect, it } from 'vitest';

import {
  defineStorageKey,
  jsonStorageCodec,
  readStorage,
  removeStorage,
  stringStorageCodec,
  writeStorage,
} from './browser-storage';


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


interface StoredTheme {
  readonly mode: 'dark' | 'light';
}


function isStoredTheme(value: unknown): value is StoredTheme {
  if (typeof value !== 'object' || value === null) return false;
  const mode = (value as { readonly mode?: unknown }).mode;
  return mode === 'dark' || mode === 'light';
}


describe('browser storage adapter', () => {
  it('round-trips typed string and JSON keys', () => {
    const storage = new MemoryStorage();
    const languageKey = defineStorageKey('language', stringStorageCodec);
    const themeKey = defineStorageKey('theme', jsonStorageCodec(isStoredTheme));

    expect(writeStorage(languageKey, 'ca', storage)).toBe(true);
    expect(writeStorage(themeKey, { mode: 'dark' }, storage)).toBe(true);
    expect(readStorage(languageKey, storage)).toBe('ca');
    expect(readStorage(themeKey, storage)).toEqual({ mode: 'dark' });
  });

  it('returns undefined for malformed typed values and tolerates unavailable storage', () => {
    const storage = new MemoryStorage();
    const themeKey = defineStorageKey('theme', jsonStorageCodec(isStoredTheme));
    storage.setItem('theme', JSON.stringify({ mode: 'invalid' }));

    expect(readStorage(themeKey, storage)).toBeUndefined();
    expect(readStorage(themeKey, null)).toBeUndefined();
    expect(writeStorage(themeKey, { mode: 'light' }, null)).toBe(false);
  });

  it('removes values through the same typed key', () => {
    const storage = new MemoryStorage();
    const key = defineStorageKey('temporary', stringStorageCodec, 'session');
    writeStorage(key, 'value', storage);

    expect(removeStorage(key, storage)).toBe(true);
    expect(readStorage(key, storage)).toBeUndefined();
  });
});
