export type StorageArea = 'local' | 'session';


export interface StorageCodec<T> {
  decode(value: string): T;
  encode(value: T): string;
}


export interface BrowserStorageKey<T> {
  readonly area: StorageArea;
  readonly codec: StorageCodec<T>;
  readonly name: string;
}


export const stringStorageCodec: StorageCodec<string> = {
  decode: (value) => value,
  encode: (value) => value,
};


export function jsonStorageCodec<T>(
  isValue: (value: unknown) => value is T,
): StorageCodec<T> {
  return {
    decode(value) {
      const parsed: unknown = JSON.parse(value);
      if (!isValue(parsed)) throw new TypeError('Stored JSON does not match its declared type');
      return parsed;
    },
    encode: (value) => JSON.stringify(value),
  };
}


export function defineStorageKey<T>(
  name: string,
  codec: StorageCodec<T>,
  area: StorageArea = 'local',
): BrowserStorageKey<T> {
  return Object.freeze({ area, codec, name });
}


function runtimeStorage(area: StorageArea): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return area === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}


function resolveStorage(
  key: BrowserStorageKey<unknown>,
  override: Storage | null | undefined,
): Storage | null {
  return override === undefined ? runtimeStorage(key.area) : override;
}


export function readStorage<T>(
  key: BrowserStorageKey<T>,
  storage?: Storage | null,
): T | undefined {
  try {
    const raw = resolveStorage(key, storage)?.getItem(key.name);
    return raw === null || raw === undefined ? undefined : key.codec.decode(raw);
  } catch {
    return undefined;
  }
}


export function writeStorage<T>(
  key: BrowserStorageKey<T>,
  value: T,
  storage?: Storage | null,
): boolean {
  try {
    const target = resolveStorage(key, storage);
    if (!target) return false;
    target.setItem(key.name, key.codec.encode(value));
    return true;
  } catch {
    return false;
  }
}


export function removeStorage(
  key: BrowserStorageKey<unknown>,
  storage?: Storage | null,
): boolean {
  try {
    const target = resolveStorage(key, storage);
    if (!target) return false;
    target.removeItem(key.name);
    return true;
  } catch {
    return false;
  }
}
