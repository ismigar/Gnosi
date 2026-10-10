import { useCallback, useSyncExternalStore } from 'react';
import { subscribeWindowEvent } from '../../../../../shared/platform/browser-events';
import { pageFreeWidthKey, readStorage, writeStorage } from './preferences';

const listeners = new Set<() => void>();
const transientPreferences = new Map<string, boolean>();

// Share the preference between two panes showing the same page, without
// writing page metadata or changing its Markdown.
export function usePageFreeWidth(pageId: string) {
  const getSnapshot = useCallback(() => (
    transientPreferences.get(pageId) ?? readStorage(pageFreeWidthKey(pageId)) === '1'
  ), [pageId]);
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    const unsubscribe = subscribeWindowEvent('storage', event => {
      if (event.key === null || event.key === pageFreeWidthKey(pageId).name) listener();
    });
    return () => { listeners.delete(listener); unsubscribe(); };
  }, [pageId]);
  const isFreeWidth = useSyncExternalStore(subscribe, getSnapshot, () => false);
  const toggleFreeWidth = useCallback(() => {
    const next = !getSnapshot();
    if (writeStorage(pageFreeWidthKey(pageId), next ? '1' : '0')) {
      transientPreferences.delete(pageId);
    } else {
      transientPreferences.set(pageId, next);
    }
    listeners.forEach(listener => { listener(); });
  }, [getSnapshot, pageId]);
  return { isFreeWidth, toggleFreeWidth };
}
