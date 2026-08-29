import {
  useCallback,
  useEffect,
  useState,
  type SetStateAction,
} from 'react';

import { emitAppEvent, subscribeAppEvent } from '../shared/platform/app-events';


const FLOATING_DOCK_EVENT = 'gnosi:floating-dock-change';


export function announceFloatingDockChange(isOpen: boolean): void {
  emitAppEvent(FLOATING_DOCK_EVENT, { isOpen });
}


export function useFloatingActionDock(): readonly [
  boolean,
  (nextValue: SetStateAction<boolean>) => void,
] {
  const [isOpen, setIsOpen] = useState(
    () => document.body.dataset.gnosiFloatingDock === 'open',
  );

  useEffect(() => subscribeAppEvent(
    FLOATING_DOCK_EVENT,
    ({ isOpen: nextIsOpen }) => {
      setIsOpen(nextIsOpen);
    },
  ), []);

  const setDockOpen = useCallback((nextValue: SetStateAction<boolean>) => {
    const next = typeof nextValue === 'function' ? nextValue(isOpen) : nextValue;
    document.body.dataset.gnosiFloatingDock = next ? 'open' : '';
    if (!next) delete document.body.dataset.gnosiFloatingDock;
    announceFloatingDockChange(next);
  }, [isOpen]);

  return [isOpen, setDockOpen] as const;
}
