import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHoverCard } from './PageHoverCard';

// Delay d'obertura una mica més curt que el hover de wikilinks (450 ms) perquè
// el cas d'ús és fer un "cop d'ull ràpid" al registre; prou alt, però, per no
// disparar-se en passar el ratolí per damunt mentre es navega per la taula.
const HOVER_OPEN_DELAY = 350;
const HOVER_CLOSE_DELAY = 180;

/**
 * Orquestra la previsualització del títol d'un registre (hover + teclat) per a
 * una vista. Manté UN sol `PageHoverCard` per vista i exposa:
 *  - `getTitleProps(pageId)`: props `onMouseEnter`/`onMouseLeave` per a
 *    l'element del títol (passa el ratolí → s'obre amb delay).
 *  - `openForKeyboard(pageId, rect)` / `close()`: control directe (Quick Look).
 *  - `active`: estat actual `{ pageId, rect, viaKeyboard }` o `null` (per a toggle).
 *  - `preview`: el JSX del card (o `null`) que la vista renderitza un sol cop.
 *
 * @param {object} [opts]
 * @param {(id: string) => void} [opts.onOpenPage] obrir la pàgina sencera.
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

    // Obre amb delay de hover (rect explícit). El reusen tant els elements
    // React (via getTitleProps) com FullCalendar (eventMouseEnter del calendari).
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
            // Si encara no s'ha obert, cancel·la l'obertura pendent; si ja és
            // obert, programa el tancament (el ratolí pot transitar cap al card,
            // que cancel·larà aquest tancament amb el seu onMouseEnter).
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
