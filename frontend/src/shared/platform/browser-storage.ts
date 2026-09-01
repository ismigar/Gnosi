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


export function listStorageKeyNames(
  area: StorageArea,
  prefix = '',
  storage?: Storage | null,
): string[] {
  try {
    const target = storage === undefined ? runtimeStorage(area) : storage;
    if (!target) return [];
    const names: string[] = [];
    for (let index = 0; index < target.length; index += 1) {
      const name = target.key(index);
      if (name?.startsWith(prefix)) names.push(name);
    }
    return names;
  } catch {
    return [];
  }
}


function resolveStorage<T>(
  key: BrowserStorageKey<unknown>,
  override: T | null | undefined,
): T | Storage | null {
  return override === undefined ? runtimeStorage(key.area) : override;
}


export type StorageReadResult<T> =
  | { readonly ok: true; readonly value: T | undefined }
  | { readonly ok: false };

/** Distinguish a missing value from a failed read before persisting derived state. */
export function readStorageResult<T>(
  key: BrowserStorageKey<T>,
  storage?: Pick<Storage, 'getItem'> | null,
): StorageReadResult<T> {
  try {
    const target = resolveStorage(key, storage);
    if (!target) return { ok: false };
    const raw = target.getItem(key.name);
    return {
      ok: true,
      value: raw === null ? undefined : key.codec.decode(raw),
    };
  } catch {
    return { ok: false };
  }
}

export function readStorage<T>(
  key: BrowserStorageKey<T>,
  storage?: Pick<Storage, 'getItem'> | null,
): T | undefined {
  const result = readStorageResult(key, storage);
  return result.ok ? result.value : undefined;
}


export function writeStorage<T>(
  key: BrowserStorageKey<T>,
  value: T,
  storage?: Pick<Storage, 'setItem'> | null,
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
  storage?: Pick<Storage, 'removeItem'> | null,
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
