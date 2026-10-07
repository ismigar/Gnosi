import {
  defineStorageKey,
  listStorageKeyNames,
  removeStorage,
  stringStorageCodec,
  type StorageArea,
} from '../src/shared/platform/browser-storage';

/** Reset storage through the same adapter as the code under test. */
export function resetBrowserTestStorage(...areas: StorageArea[]): void {
  for (const area of areas) {
    for (const name of listStorageKeyNames(area)) {
      if (!removeStorage(defineStorageKey(name, stringStorageCodec, area))) {
        throw new Error(`Cannot reset test storage key ${name}`);
      }
    }
  }
}
