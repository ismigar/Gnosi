import { useEffect, type RefObject } from 'react';
import { subscribeWindowEvent } from '../platform/browser-events';
import { canKeyboardScroll, isVerticalScrollRegion, nearestVerticalScrollRegion, ownsKeyboardNavigation } from './keyboardScroll';

const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']);

// Nested app pages scroll independently of the document. Route unclaimed keys
// to the focused region, or the region last clicked when focus is on the body.
export function useAppKeyboardScroll(mainRef: RefObject<HTMLElement | null>, routeKey: string): void {
  useEffect(() => {
    let pointerTarget: HTMLElement | null = null;
    const unsubscribePointer = subscribeWindowEvent('pointerdown', event => {
      let element = event.target instanceof Element ? event.target : null;
      while (element && !(element instanceof HTMLElement)) element = element.parentElement;
      pointerTarget = element;
    }, true);
    const unsubscribeKey = subscribeWindowEvent('keydown', event => {
      if (!SCROLL_KEYS.has(event.key)) return;
      const active = document.activeElement;
      const looseFocus = active === document.body || active === document.documentElement;
      const origin = looseFocus ? (pointerTarget?.isConnected ? pointerTarget : mainRef.current) : active;
      if (!(origin instanceof HTMLElement) || !canKeyboardScroll(event, origin, origin) || ownsKeyboardNavigation(origin)) return;
      let target = nearestVerticalScrollRegion(origin);
      if (target && !canKeyboardScroll(event, target, origin)) return;
      if (!target && origin === mainRef.current) {
        // Initial keyboard-only navigation: use the largest visible page region
        // when the shell itself contains a separate, full-height scroller.
        let area = 0;
        for (const candidate of origin.querySelectorAll<HTMLElement>('*')) {
          if (candidate.closest('aside, nav, [role="navigation"]')) continue;
          if (!isVerticalScrollRegion(candidate) || !canKeyboardScroll(event, candidate, candidate)) continue;
          const rect = candidate.getBoundingClientRect();
          if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) continue;
          const size = candidate.clientWidth * candidate.clientHeight;
          if (size > area) { target = candidate; area = size; }
        }
      }
      if (!target) return;
      const behavior = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      event.preventDefault();
      if (event.key === 'Home' || event.key === 'End') {
        target.scrollTo({ top: event.key === 'Home' ? 0 : target.scrollHeight, behavior });
      } else {
        const backwards = event.key === 'ArrowUp' || event.key === 'PageUp' || (event.key === ' ' && event.shiftKey);
        const distance = event.key.startsWith('Arrow') ? 80 : target.clientHeight * 0.8;
        target.scrollBy({ top: backwards ? -distance : distance, behavior });
      }
    });
    return () => { unsubscribePointer(); unsubscribeKey(); };
  }, [mainRef, routeKey]);
}
