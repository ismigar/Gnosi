import { forwardRef, useLayoutEffect, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';

interface CellDropdownPortalProps {
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly className?: string;
  readonly maxHeight?: number;
  readonly children: ReactNode;
}

// A cell's dropdown (select/multi_select) rendered in a PORTAL at
// `document.body` with `position: fixed`, anchored below the input. This way it escapes the
// embedded table's `overflow-auto` scroller (which used to clip it when
// the view was short) and the embed block's `isolate` stacking context, and
// always stays on top (max z-index). If it doesn't fit below, it flips upward.
// The click-outside for pickers must ignore clicks inside the portal: we mark it
// with `data-cell-dropdown` and check it with `closest('[data-cell-dropdown]')`.
export const CellDropdownPortal = forwardRef<HTMLDivElement, CellDropdownPortalProps>(function CellDropdownPortal(
  { anchorRef, className = '', maxHeight = 240, children },
  ref,
) {
  const [pos, setPos] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    let raf = 0;
    const compute = () => {
      const el = anchorRef.current;
      // Layout effects run child-first: on the first mount the
      // the parent container's `ref` (anchorRef) may not be attached yet.
      // Retries on the next frame, when it's already there.
      if (!el) { raf = requestAnimationFrame(compute); return; }
      const r = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;
      const flipUp = spaceBelow < Math.min(maxHeight, 160) && spaceAbove > spaceBelow;
      const avail = (flipUp ? spaceAbove : spaceBelow) - 8;
      setPos({
        left: Math.round(r.left),
        width: Math.round(r.width),
        top: flipUp ? undefined : Math.round(r.bottom + 4),
        bottom: flipUp ? Math.round(window.innerHeight - r.top + 4) : undefined,
        maxHeight: Math.max(80, Math.min(maxHeight, avail)),
      });
    };
    compute();
    // `true` (capture) to catch scroll from ANY ancestor container
    // (the table's internal scroller), not just window's.
    const stopScroll = subscribeWindowEvent('scroll', compute, true);
    const stopResize = subscribeWindowEvent('resize', compute);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      stopScroll();
      stopResize();
    };
  }, [anchorRef, maxHeight]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={ref}
      data-cell-dropdown
      className={`overflow-y-auto custom-scrollbar border border-[var(--border-primary)] rounded bg-[var(--bg-primary)] shadow-xl ${className}`}
      style={{
        position: 'fixed',
        left: pos.left,
        width: pos.width,
        top: pos.top,
        bottom: pos.bottom,
        maxHeight: pos.maxHeight,
        zIndex: 'var(--z-popover)',
      }}
    >
      {children}
    </div>,
    document.body,
  );
});
