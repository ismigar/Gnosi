import { useEffect } from 'react';

import { emitAppEvent, subscribeAppEvent } from '../platform/app-events';


const FLOATING_PANEL_EVENT = 'gnosi:floating-panel-open';


export function announceFloatingPanelOpen(panelId: string): void {
  emitAppEvent(FLOATING_PANEL_EVENT, { panelId });
}


export function useExclusiveFloatingPanel(
  panelId: string,
  isOpen: boolean,
  setOpen: (isOpen: boolean) => void,
): void {
  useEffect(() => subscribeAppEvent(
    FLOATING_PANEL_EVENT,
    ({ panelId: openedPanelId }) => {
      if (isOpen && openedPanelId !== panelId) setOpen(false);
    },
  ), [isOpen, panelId, setOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    document.body.dataset.gnosiFloatingPanel = panelId;
    return () => {
      if (document.body.dataset.gnosiFloatingPanel === panelId) {
        delete document.body.dataset.gnosiFloatingPanel;
      }
    };
  }, [isOpen, panelId]);
}
