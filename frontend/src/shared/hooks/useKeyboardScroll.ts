import { useEffect, type RefObject } from 'react';
import { subscribeWindowEvent } from '../platform/browser-events';
import { canKeyboardScroll, nearestVerticalScrollRegion, ownsKeyboardNavigation } from './keyboardScroll';
import { usePaneVisibility } from '../ui/PaneVisibility';


export interface KeyboardScrollOptions {
  readonly enabled?: boolean;
  readonly modalOpen?: boolean;
  readonly step?: number;
}


export function useKeyboardScroll(
  scrollContainerRef: RefObject<HTMLElement | null> | null | undefined,
  { enabled = true, modalOpen = false, step = 80 }: KeyboardScrollOptions = {},
): void {
  const visible = usePaneVisibility();
  useEffect(() => {
    if (!visible || !enabled || modalOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      const configured = scrollContainerRef?.current;
      if (!configured || !canKeyboardScroll(event, configured)) return;
      const active = document.activeElement;
      if (ownsKeyboardNavigation(active)) return;
      const target = active instanceof HTMLElement ? nearestVerticalScrollRegion(active, configured) ?? configured : configured;
      if (!canKeyboardScroll(event, target)) return;
      const behavior = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        target.scrollBy({ top: step, behavior });
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        target.scrollBy({ top: -step, behavior });
      } else if (event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) {
        event.preventDefault();
        target.scrollBy({ top: target.clientHeight * 0.8, behavior });
      } else if (event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) {
        event.preventDefault();
        target.scrollBy({ top: -target.clientHeight * 0.8, behavior });
      } else if (event.key === 'Home') {
        event.preventDefault();
        target.scrollTo({ top: 0, behavior });
      } else if (event.key === 'End') {
        event.preventDefault();
        target.scrollTo({ top: target.scrollHeight, behavior });
      }
    };

    return subscribeWindowEvent('keydown', handleKeyDown);
  }, [visible, enabled, modalOpen, step, scrollContainerRef]);
}
