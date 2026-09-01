import { memo, useEffect, useRef } from 'react';
import type { InfiniteLoadSentinelProps } from './pickerTypes';

/**
 * Sentinel that fires `onLoadMore` when it enters the viewport.
 *
 * Replaces the manual "Show more" button: the table loads the first
 * `ROWS_BATCH_SIZE` rows and, when the user reaches the end, the next ones
 * appear on their own. This way we don't pay the cost of mounting 300 rows on the first
 * render (~4 s observed) and we keep the feel of a complete list.
 *
 * Implemented with `IntersectionObserver` (zero polling, released on
 * dismount) + a synchronous fallback button in case the autoload doesn't trigger
 * (DOM where the sentinel isn't visible, e.g. inside a dialog with
 * `display:none` while switching tabs).
 */
export const InfiniteLoadSentinel = memo(function InfiniteLoadSentinel({ visibleCount, total, batchSize, onLoadMore, label }: InfiniteLoadSentinelProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          onLoadMore();
          break;
        }
      }
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => { io.disconnect(); };
  }, [onLoadMore]);

  return (
    <div
      ref={ref}
      className="px-4 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-primary)] flex items-center justify-between"
    >
      <span className="text-xs text-[var(--text-tertiary)]">{label}</span>
      <button
        onClick={onLoadMore}
        className="btn-gnosi btn-gnosi-primary !px-3 !py-1.5"
      >
        +{Math.min(batchSize, total - visibleCount)}
      </button>
    </div>
  );
});
