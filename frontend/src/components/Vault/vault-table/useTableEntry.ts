import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeDocumentEvent } from '../../../shared/platform/browser-events';
import type { PendingTableAction } from './types';
import type { useTableState } from './useTableState';

type Inputs = Pick<ReturnType<typeof useTableState>, 'setVisibleRowsCount' | 'ROWS_BATCH_SIZE' | 'setIsDropdownOpen' | 'addingSubitemFor'>;

export function useTableEntry({ setVisibleRowsCount, ROWS_BATCH_SIZE, setIsDropdownOpen, addingSubitemFor }: Inputs) {
  const handleLoadMoreRows = useCallback(() => {
    setVisibleRowsCount(prev => prev + ROWS_BATCH_SIZE);
  }, [ROWS_BATCH_SIZE, setVisibleRowsCount]);
  const [newRowTitle, setNewRowTitle] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingTableAction | null>(null);
  const [executingButtonKey, setExecutingButtonKey] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const subitemInputRef = useRef<HTMLInputElement | null>(null);
  const newRowInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !(event.target instanceof Node && dropdownRef.current.contains(event.target))) {
        setIsDropdownOpen(false);
      }
    };
    const unsubscribehandleClickOutside = subscribeDocumentEvent('mousedown', handleClickOutside);
    return () => { unsubscribehandleClickOutside(); };
  }, [setIsDropdownOpen]);
  useEffect(() => {
    if (addingSubitemFor && subitemInputRef.current) {
      subitemInputRef.current.focus();
    }
  }, [addingSubitemFor]);
  return { handleLoadMoreRows, newRowTitle, setNewRowTitle, pendingAction, setPendingAction, executingButtonKey, setExecutingButtonKey, subitemInputRef, newRowInputRef };
}
