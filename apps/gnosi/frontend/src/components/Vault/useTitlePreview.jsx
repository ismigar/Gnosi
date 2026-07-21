import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHoverCard } from './PageHoverCard';

// Opening delay a bit shorter than the wikilink hover (450 ms) because
// the use case is taking a "quick look" at the record; high enough, though, to not
// trigger just from moving the mouse over it while navigating the table.
const HOVER_OPEN_DELAY = 350;
const HOVER_CLOSE_DELAY = 180;

/**
 * Orchestrates the title preview of a record (hover + keyboard) for
 * a view. Keeps a SINGLE `PageHoverCard` per view and exposes:
 *  - `getTitleProps(pageId)`: `onMouseEnter`/`onMouseLeave` props for
 *    the title element (mouse hovers over it → opens with a delay).
 *  - `openForKeyboard(pageId, rect)` / `close()`: direct control (Quick Look).
 *  - `active`: current state `{ pageId, rect, viaKeyboard }` or `null` (for toggling).
 *  - `preview`: the card's JSX (or `null`) that the view renders a single time.
 *
 * @param {object} [opts]
 * @param {(id: string) => void} [opts.onOpenPage] open the full page.
 */
export function useTitlePreview({ onOpenPage } = {}) {
    const [active, setActive] = useState(null); // { pageId, rect, viaKeyboard }
    const openTimer = useRef(null);
    const closeTimer = useRef(null);

    const clearTimers = useCallback(() => {
        if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
        if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    }, []);

    useEffect(() => () => clearTimers(), [clearTimers]);

    const close = useCallback(() => {
        clearTimers();
        setActive(null);
    }, [clearTimers]);

    const openForKeyboard = useCallback((pageId, rect) => {
        if (!pageId || !rect) return;
        clearTimers();
        setActive({ pageId, rect, viaKeyboard: true });
    }, [clearTimers]);

    const scheduleClose = useCallback(() => {
        clearTimers();
        closeTimer.current = setTimeout(() => setActive(null), HOVER_CLOSE_DELAY);
    }, [clearTimers]);

    // Opens with a hover delay (explicit rect). Reused by both the
    // React (via getTitleProps) and FullCalendar (the calendar's eventMouseEnter).
    const openHover = useCallback((pageId, rect) => {
        if (!pageId || !rect) return;
        clearTimers();
        openTimer.current = setTimeout(() => {
            setActive({ pageId, rect, viaKeyboard: false });
        }, HOVER_OPEN_DELAY);
    }, [clearTimers]);

    const getTitleProps = useCallback((pageId) => ({
        onMouseEnter: (e) => openHover(pageId, e.currentTarget.getBoundingClientRect()),
        onMouseLeave: () => {
            // If it hasn't opened yet, cancels the pending opening; if it's already
            // open, schedules the closing (the mouse might move toward the card,
            // which will cancel this closing via its own onMouseEnter).
            if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
            scheduleClose();
        },
    }), [openHover, scheduleClose]);

    const preview = active ? (
        <PageHoverCard
            pageId={active.pageId}
            anchorRect={active.rect}
            viaKeyboard={active.viaKeyboard}
            onClose={close}
            onOpenPage={onOpenPage}
            onMouseEnter={clearTimers}
            onMouseLeave={scheduleClose}
        />
    ) : null;

    return { active, getTitleProps, openHover, scheduleClose, cancelClose: clearTimers, openForKeyboard, close, preview };
}

export default useTitlePreview;
