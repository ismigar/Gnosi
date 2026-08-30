import {
  defineStorageKey,
  listStorageKeyNames,
  removeStorage,
  stringStorageCodec,
} from '../shared/platform/browser-storage';

/** Reset only the isolated test document's persistent context. */
export function resetApiTestStorage(): void {
  for (const name of listStorageKeyNames('local')) {
    removeStorage(defineStorageKey(name, stringStorageCodec));
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
