import { useEffect, useRef, type FocusEvent, type MouseEvent, type RefObject } from 'react';
import { subscribeDocumentEvent } from '../../../../shared/platform/browser-events';
import { isOutsidePicker } from './pickerTypes';

export function useCellEditorFocus(containerRef: RefObject<HTMLDivElement | null>, onExit: () => void) {
  const pressingInside = useRef(false);
  const ownsFocus = useRef(false);

  useEffect(() => {
    const initialContainer = containerRef.current;
    if (initialContainer && !isOutsidePicker(initialContainer, initialContainer.ownerDocument.activeElement)) {
      ownsFocus.current = true;
    }
    const stopFocus = subscribeDocumentEvent('focusin', (event) => {
      const container = containerRef.current;
      if (!container) return;
      const inside = !isOutsidePicker(container, event.target);
      const left = ownsFocus.current && !inside;
      ownsFocus.current = inside;
      // Removing the focused control can skip blur in the browser.
      if (left) onExit();
    }, true);
    const stopDown = subscribeDocumentEvent('mousedown', (event) => {
      const container = containerRef.current;
      if (!container) return;
      pressingInside.current = !isOutsidePicker(container, event.target);
      // With focus inside, blur closes the editor after its inputs commit.
      if (!pressingInside.current && isOutsidePicker(container, container.ownerDocument.activeElement)) {
        ownsFocus.current = false;
        onExit();
      }
    }, true);
    const stopUp = subscribeDocumentEvent('mouseup', () => { pressingInside.current = false; }, true);
    return () => { stopFocus(); stopDown(); stopUp(); };
  }, [containerRef, onExit]);

  return {
    onBlur: (event: FocusEvent<HTMLDivElement>) => {
      if (!isOutsidePicker(event.currentTarget, event.relatedTarget)) return;
      // A label, blank area or popup backdrop can briefly send focus to body.
      if (event.relatedTarget === null && pressingInside.current) return;
      ownsFocus.current = false;
      onExit();
    },
    onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
      const container = event.currentTarget;
      if (container.ownerDocument.activeElement === container.ownerDocument.body) {
        (container.tabIndex === -1 ? container : container.querySelector('input'))?.focus({ preventScroll: true });
      }
    },
  };
}
