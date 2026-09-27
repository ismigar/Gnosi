import { useEffect, type RefObject } from 'react';
import { subscribeWindowEvent } from '../platform/browser-events';
import { canKeyboardScroll } from './keyboardScroll';


export interface KeyboardScrollOptions {
  readonly enabled?: boolean;
  readonly modalOpen?: boolean;
  readonly step?: number;
}


export function useKeyboardScroll(
  scrollContainerRef: RefObject<HTMLElement | null> | null | undefined,
  { enabled = true, modalOpen = false, step = 80 }: KeyboardScrollOptions = {},
): void {
  useEffect(() => {
    if (!enabled || modalOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = scrollContainerRef?.current;
      if (!target || !canKeyboardScroll(event, target)) return;
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
  }, [enabled, modalOpen, step, scrollContainerRef]);
}
