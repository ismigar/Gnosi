import {
  defineStorageKey,
  jsonStorageCodec,
  readStorage,
  readStorageResult,
  stringStorageCodec,
  writeStorage,
} from '../../../shared/platform/browser-storage';

const TOGGLE_STATE_PREFIX = 'gnosi.vault.toggle-expansion.';
const TOGGLE_DOM_STATE_PREFIX = 'gnosi.vault.toggle-dom-expansion.';

type StorageKeyValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface ToggleEntry {
  id: StorageKeyValue;
  key: string;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStorageKeyValue(
  record: Record<string, unknown>,
  key: string,
): StorageKeyValue {
  const value = record[key];
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return undefined;
}

function contentSignature(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!isUnknownArray(content)) return '';
  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!isUnknownRecord(item)) return '';
      if (item.type === 'text') {
        return readStorageKeyValue(item, 'text') || '';
      }
      const props = item.props;
      if (!isUnknownRecord(props)) return '';
      return (
        readStorageKeyValue(props, 'title') ||
        readStorageKeyValue(props, 'content') ||
        ''
      );
    })
    .join('')
    .trim();
}

function toggleEntries(
  blocks: unknown,
  parentPath = '',
): ToggleEntry[] {
  if (!isUnknownArray(blocks)) return [];
  return blocks.flatMap((block, index) => {
    const path = parentPath
      ? `${parentPath}.${String(index)}`
      : String(index);
    if (!isUnknownRecord(block)) return [];
    const entry: ToggleEntry[] =
      block.type === 'toggleListItem'
        ? [
            {
              id: readStorageKeyValue(block, 'id'),
              key: `${path}:${contentSignature(block.content)}`,
            },
          ]
        : [];
    return [...entry, ...toggleEntries(block.children, path)];
  });
}

function pageStorageKey(pageId: StorageKeyValue) {
  return defineStorageKey(
    TOGGLE_STATE_PREFIX + String(pageId),
    jsonStorageCodec(isUnknownRecord),
  );
}

function domStorageKey(pageId: StorageKeyValue) {
  return defineStorageKey(
    TOGGLE_DOM_STATE_PREFIX + String(pageId),
    jsonStorageCodec(isUnknownArray),
  );
}

function blockStorageKey(id: StorageKeyValue) {
  return defineStorageKey(`toggle-${String(id)}`, stringStorageCodec);
}

export function restoreToggleExpansionState(
  pageId: StorageKeyValue,
  blocks: unknown,
  storage?: StorageLike | null,
): void {
  if (!pageId || storage === null) return;
  const saved = readStorage(pageStorageKey(pageId), storage);
  if (!saved) return;

  toggleEntries(blocks).forEach(({ id, key }) => {
    if (!id || !Object.hasOwn(saved, key)) return;
    writeStorage(blockStorageKey(id), saved[key] ? 'true' : 'false', storage);
  });
}

export function saveToggleExpansionState(
  pageId: StorageKeyValue,
  blocks: unknown,
  storage?: StorageLike | null,
): void {
  if (!pageId || storage === null) return;
  const state: Record<string, boolean> = {};
  for (const { id, key } of toggleEntries(blocks)) {
    if (!id) continue;
    const current = readStorageResult(blockStorageKey(id), storage);
    if (!current.ok) return;
    state[key] = current.value === 'true';
  }

  writeStorage(pageStorageKey(pageId), state, storage);
}

export function saveToggleDomExpansionState(
  pageId: StorageKeyValue,
  root: ParentNode | null | undefined,
  storage?: StorageLike | null,
): void {
  if (!pageId || !root || storage === null) return;
  const state = Array.from(
    root.querySelectorAll<HTMLElement>('.bn-toggle-wrapper'),
  ).map(
    (wrapper) =>
      wrapper.getAttribute('data-show-children') === 'true',
  );
  writeStorage(domStorageKey(pageId), state, storage);
}

export function restoreToggleDomExpansionState(
  pageId: StorageKeyValue,
  root: ParentNode | null | undefined,
  storage?: StorageLike | null,
): void {
  if (!pageId || !root || storage === null) return;
  const state = readStorage(domStorageKey(pageId), storage);
  if (!state) return;
  Array.from(
    root.querySelectorAll<HTMLElement>('.bn-toggle-wrapper'),
  ).forEach((wrapper, index) => {
    if (
      !state[index] ||
      wrapper.getAttribute('data-show-children') === 'true'
    ) {
      return;
    }
    wrapper.querySelector<HTMLButtonElement>('.bn-toggle-button')?.click();
  });
}
