import { useEffect, type RefObject } from 'react';


export interface KeyboardScrollOptions {
  readonly enabled?: boolean;
  readonly modalOpen?: boolean;
  readonly step?: number;
}


function activeElementAcceptsText(): boolean {
  const active = document.activeElement;
  return Boolean(active && (
    active.tagName === 'INPUT'
    || active.tagName === 'TEXTAREA'
    || active.tagName === 'SELECT'
    || (active instanceof HTMLElement && active.isContentEditable)
  ));
}


export function useKeyboardScroll(
  scrollContainerRef: RefObject<HTMLElement | null> | null | undefined,
  { enabled = true, modalOpen = false, step = 80 }: KeyboardScrollOptions = {},
): void {
  useEffect(() => {
    if (!enabled || modalOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeElementAcceptsText()) return;

      const target = scrollContainerRef?.current;
      if (!target) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        target.scrollBy({ top: step, behavior: 'smooth' });
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        target.scrollBy({ top: -step, behavior: 'smooth' });
      } else if (event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) {
        event.preventDefault();
        target.scrollBy({ top: target.clientHeight * 0.8, behavior: 'smooth' });
      } else if (event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) {
        event.preventDefault();
        target.scrollBy({ top: -target.clientHeight * 0.8, behavior: 'smooth' });
      } else if (event.key === 'Home') {
        event.preventDefault();
        target.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (event.key === 'End') {
        event.preventDefault();
        target.scrollTo({ top: target.scrollHeight, behavior: 'smooth' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, modalOpen, step, scrollContainerRef]);
}
