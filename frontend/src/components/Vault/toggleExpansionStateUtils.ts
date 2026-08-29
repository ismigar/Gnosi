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

function pageStorageKey(pageId: StorageKeyValue): string {
  return TOGGLE_STATE_PREFIX + String(pageId);
}

function domStorageKey(pageId: StorageKeyValue): string {
  return TOGGLE_DOM_STATE_PREFIX + String(pageId);
}

export function restoreToggleExpansionState(
  pageId: StorageKeyValue,
  blocks: unknown,
  storage: StorageLike | null = window.localStorage,
): void {
  if (!pageId || !storage) return;
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(pageStorageKey(pageId)) || '{}',
    );
    if (!isUnknownRecord(parsed)) return;
    saved = parsed;
  } catch {
    return;
  }

  toggleEntries(blocks).forEach(({ id, key }) => {
    if (!id || !Object.hasOwn(saved, key)) return;
    storage.setItem(`toggle-${String(id)}`, saved[key] ? 'true' : 'false');
  });
}

export function saveToggleExpansionState(
  pageId: StorageKeyValue,
  blocks: unknown,
  storage: StorageLike | null = window.localStorage,
): void {
  if (!pageId || !storage) return;
  const state: Record<string, boolean> = {};
  toggleEntries(blocks).forEach(({ id, key }) => {
    if (!id) return;
    state[key] = storage.getItem(`toggle-${String(id)}`) === 'true';
  });

  try {
    storage.setItem(pageStorageKey(pageId), JSON.stringify(state));
  } catch {
    // Keep toggle controls usable when browser storage is unavailable.
  }
}

export function saveToggleDomExpansionState(
  pageId: StorageKeyValue,
  root: ParentNode | null | undefined,
  storage: StorageLike | null = window.localStorage,
): void {
  if (!pageId || !root || !storage) return;
  const state = Array.from(
    root.querySelectorAll<HTMLElement>('.bn-toggle-wrapper'),
  ).map(
    (wrapper) =>
      wrapper.getAttribute('data-show-children') === 'true',
  );
  try {
    storage.setItem(domStorageKey(pageId), JSON.stringify(state));
  } catch {
    // Keep toggle controls usable when browser storage is unavailable.
  }
}

export function restoreToggleDomExpansionState(
  pageId: StorageKeyValue,
  root: ParentNode | null | undefined,
  storage: StorageLike | null = window.localStorage,
): void {
  if (!pageId || !root || !storage) return;
  let state: unknown;
  try {
    state = JSON.parse(storage.getItem(domStorageKey(pageId)) || 'null');
  } catch {
    return;
  }
  if (!isUnknownArray(state)) return;
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
