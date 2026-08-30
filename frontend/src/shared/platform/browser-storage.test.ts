import { describe, expect, it } from 'vitest';

import {
  defineStorageKey,
  jsonStorageCodec,
  listStorageKeyNames,
  readStorage,
  readStorageResult,
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
  it('accepts only the capability required by each injected operation', () => {
    const key = defineStorageKey('minimal', stringStorageCodec);
    let stored: string | null = null;
    expect(writeStorage(key, 'exact', { setItem: (_name, value) => { stored = value; } })).toBe(true);
    expect(readStorage(key, { getItem: () => stored })).toBe('exact');
    expect(removeStorage(key, { removeItem: () => { stored = null; } })).toBe(true);
    expect(readStorage(key, { getItem: () => stored })).toBeUndefined();
  });

  it('distinguishes missing values from failed reads without changing the convenience API', () => {
    const key = defineStorageKey('exact', stringStorageCodec);
    const broken = { getItem: () => { throw new Error('Storage disabled'); } };
    expect(readStorageResult(key, { getItem: () => null })).toEqual({ ok: true, value: undefined });
    expect(readStorageResult(key, { getItem: () => 'false' })).toEqual({ ok: true, value: 'false' });
    expect(readStorageResult(key, broken)).toEqual({ ok: false });
    expect(readStorageResult(key, null)).toEqual({ ok: false });
    expect(readStorage(key, broken)).toBeUndefined();
    expect(writeStorage(key, 'new', { setItem: () => { throw new Error('Quota exceeded'); } })).toBe(false);
    expect(removeStorage(key, { removeItem: () => { throw new Error('Storage disabled'); } })).toBe(false);
  });

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

  it('lists only keys matching a prefix', () => {
    const storage = new MemoryStorage();
    storage.setItem('mail-one', '1');
    storage.setItem('other', '2');
    storage.setItem('mail-two', '3');

    expect(listStorageKeyNames('local', 'mail-', storage)).toEqual([
      'mail-one',
      'mail-two',
    ]);
  });
});
