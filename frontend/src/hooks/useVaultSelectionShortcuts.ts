import { useEffect } from 'react';
import { subscribeWindowEvent } from '../shared/platform/browser-events';


export interface VaultSelectionShortcutsOptions {
  readonly clearSelection?: () => void;
  readonly enabled?: boolean;
  readonly onDeleteSelected?: () => void;
  readonly selectAll?: () => void;
}


function activeElementAcceptsText(): boolean {
  const activeElement = document.activeElement;
  const tag = activeElement?.tagName;
  return tag === 'INPUT'
    || tag === 'TEXTAREA'
    || (activeElement instanceof HTMLElement && activeElement.isContentEditable);
}


export function useVaultSelectionShortcuts({
  selectAll,
  clearSelection,
  onDeleteSelected,
  enabled = true,
}: VaultSelectionShortcutsOptions): void {
  useEffect(() => {
    if (!enabled) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        if (activeElementAcceptsText()) return;
        event.preventDefault();
        selectAll?.();
      }

      if (event.key === 'Escape') clearSelection?.();

      if (
        (event.key === 'Delete' || event.key === 'Backspace')
        && onDeleteSelected
      ) {
        if (activeElementAcceptsText()) return;
        onDeleteSelected();
      }
    };

    return subscribeWindowEvent('keydown', handleKeyDown);
  }, [selectAll, clearSelection, onDeleteSelected, enabled]);
}
