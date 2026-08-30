import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createTableVirtualizerStore } from './tableVirtualizerStore';
import type { TableVirtualizerOptions } from './tableVirtualizerStore';

const useCommitEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

export function useTableVirtualizer(options: TableVirtualizerOptions) {
  const [store] = useState(() => createTableVirtualizerStore(options));
  useCommitEffect(() => store.mount(), [store]);
  // Match TanStack's per-commit option/element synchronization; changes publish
  // a new snapshot before paint, without replacing the engine or row keys.
  useCommitEffect(() => { store.update(options); });
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { rowVirtualizer: store.commands, virtualRows: snapshot.virtualRows, virtTotalSize: snapshot.totalSize };
}
