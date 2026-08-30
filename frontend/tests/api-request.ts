import {
  defineStorageKey,
  listStorageKeyNames,
  removeStorage,
  stringStorageCodec,
  writeStorage,
} from '../src/shared/platform/browser-storage';

/** Reset only the isolated test document's persistent context. */
export function resetApiTestStorage(): void {
  for (const name of listStorageKeyNames('local')) {
    removeStorage(defineStorageKey(name, stringStorageCodec));
  }
}

/** Use exact legacy context keys and fail loudly if the test cannot persist them. */
export function writeApiTestStorage(name: string, value: string): void {
  if (!writeStorage(defineStorageKey(name, stringStorageCodec), value)) {
    throw new Error(`Cannot initialize test storage key ${name}`);
  }
}

export function requestAt(calls: [RequestInfo | URL, RequestInit?][], index: number): Request {
  const call = calls[index];
  if (!call) throw new Error(`Expected fetch call ${String(index)}`);
  const [input, init] = call;
  return input instanceof Request
    ? input
    : new Request(new URL(String(input), window.location.origin), init);
}
