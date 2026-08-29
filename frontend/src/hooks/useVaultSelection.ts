import { useCallback, useState } from 'react';


export interface SelectableVaultPage<Id> {
  readonly id: Id;
}


type ShiftKeyInput = boolean | { readonly shiftKey?: boolean } | null | undefined;


export function useVaultSelection<Id = string>(
  pages: readonly SelectableVaultPage<Id>[] = [],
) {
  const [selectedIds, setSelectedIds] = useState<Set<Id>>(() => new Set());

  const toggleSelection = useCallback((
    id: Id,
    isShift = false,
    allIds: readonly Id[] = [],
  ) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (isShift && allIds.length > 0 && previous.size > 0) {
        const lastSelected = [...previous].at(-1);
        const lastIndex = lastSelected === undefined ? -1 : allIds.indexOf(lastSelected);
        const currentIndex = allIds.indexOf(id);
        if (lastIndex === -1 || currentIndex === -1) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        } else {
          const [from, to] = lastIndex < currentIndex
            ? [lastIndex, currentIndex]
            : [currentIndex, lastIndex];
          for (let index = from; index <= to; index += 1) {
            const rangeId = allIds[index];
            if (rangeId !== undefined) next.add(rangeId);
          }
        }
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelect = useCallback((id: Id, eventOrShift: ShiftKeyInput = false) => {
    const isShift = typeof eventOrShift === 'boolean'
      ? eventOrShift
      : Boolean(eventOrShift?.shiftKey);
    toggleSelection(id, isShift, pages.map((page) => page.id));
  }, [pages, toggleSelection]);

  const selectAll = useCallback((ids: readonly Id[] | null = null) => {
    const sourceIds = ids ?? pages.map((page) => page.id);
    setSelectedIds(new Set(sourceIds));
  }, [pages]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback(
    (id: Id) => selectedIds.has(id),
    [selectedIds],
  );

  return {
    selectedIds,
    toggleSelection,
    toggleSelect,
    selectAll,
    clearSelection,
    isSelected,
  };
}
