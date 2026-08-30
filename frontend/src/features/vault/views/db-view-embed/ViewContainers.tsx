import type { BoxProps } from './types';
// so as not to recreate the component type on every render (this would avoid remounts).
export const ScrollBox = ({ children }: BoxProps) => (
    // `w-full max-w-full min-w-0` pins the width to that of the container of
    // the editor (not the content's); `overflow-x-auto` makes the table
    // wide scroll INSIDE the box and not overflow the page/editor.
    <div className="my-2 w-full max-w-full min-w-0 max-h-[70vh] min-h-[8rem] overflow-x-auto overflow-y-auto focus-within:ring-1 focus-within:ring-[var(--gnosi-primary)]/30 transition-all">
        {children}
    </div>
);

// Container for the TABLE/list: does NOT scroll on its own (overflow-hidden) and is
// flex-col with bounded height so that VaultTable itself (which has its own
// internal scroller + sticky `title` column) handles the horizontal scroll and
// vertical. If we wrapped the table in a box with `overflow-x-auto`,
// the box would handle the horizontal scroll and the sticky column would not stay fixed.
//
// `isolate` (isolation: isolate) creates a stacking context that CONFINES the
// VaultTable's internal z-index values (sticky cells use z-20/z-30/z-40).
// Without this, since neither the box nor the scroller create a stacking context,
// these z-index values rise up to the embed's root and cover the dropdowns of
// the tab bar (the sticky title column, z-40, was painting over
// the "+"/"…" menu). With `isolate`, the table participates as a single block and the
// menus (in the bar, positioned) always stay on top.
//
// ADAPTIVE height: we no longer force `h-[60vh]` (it left a big gap with few
// rows). VaultTable receives `maxHeight` and its scroller takes the height of the
// content, scrolling internally only if it exceeds it. That's why the box has no
// fixed height nor `overflow-hidden` (which would clip menus that open downward):
// the border/rounding is applied by the table's own scroller (`isEmbedded` mode).
export const TableBox = ({ children }: BoxProps) => (
    <div className="my-2 w-full max-w-full min-w-0 isolate">
        {children}
    </div>
);

// Embedded FEED container: GROWS with the content (like Notion) and it's the
// PAGE that scrolls — no 70vh box with internal scroll. The
// feed's infinite scroll plays in our favor: it starts with a small batch and the sentinel
// (which resolves the real scroller via getScrollParent) keeps loading the rest into
// as you scroll down the page; "See more" also expands the page.
export const FeedFlowBox = ({ children }: BoxProps) => (
    <div className="mt-0 mb-2 w-full max-w-full min-w-0 rounded-xl border border-transparent focus-within:border-[var(--gnosi-primary)]/50 focus-within:ring-1 focus-within:ring-[var(--gnosi-primary)]/30 overflow-hidden transition-all">
        {children}
    </div>
);

/* -------------------------------------------------------------------------- */
/*  Filter / sort / format utilities                                  */
/* -------------------------------------------------------------------------- */
