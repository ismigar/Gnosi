import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import { subscribeDocumentEvent, subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { getViewPopoverLayout } from '../../../shared/ui/previews/viewPopoverLayout';

/** A lazy, viewport-bound preview shared by model offers and role evidence. */
export function ComparisonDetails({ className = '', preview, summary, children }: {
    readonly className?: string;
    readonly preview?: ReactNode;
    readonly summary: ReactNode;
    readonly children: () => ReactNode;
}) {
    const id = useId();
    const anchor = useRef<HTMLDivElement>(null);
    const popup = useRef<HTMLDivElement>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [open, setOpen] = useState(false);
    const [portalTarget, setPortalTarget] = useState<Element | null>(null);
    const [position, setPosition] = useState<ReturnType<typeof getViewPopoverLayout> | null>(null);
    const cancelClose = () => { clearTimeout(closeTimer.current); };
    const close = () => { cancelClose(); setOpen(false); };
    const show = () => {
        cancelClose();
        if (anchor.current) {
            setPortalTarget(anchor.current.closest('.model-comparison-modal') ?? document.body);
            setPosition(getViewPopoverLayout(anchor.current.getBoundingClientRect(), window.innerWidth, window.innerHeight));
            setOpen(true);
        }
    };
    const leave = () => { cancelClose(); closeTimer.current = setTimeout(() => { setOpen(false); }, 160); };
    useModalKeyboard({ isOpen: open, onClose: close, containerRef: popup });
    useEffect(() => () => { clearTimeout(closeTimer.current); }, []);
    useEffect(() => {
        if (!open) return;
        const outside = subscribeDocumentEvent('pointerdown', event => {
            if (event.target instanceof Node && !anchor.current?.contains(event.target) && !popup.current?.contains(event.target)) setOpen(false);
        });
        const scroll = subscribeWindowEvent('scroll', event => {
            if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) setOpen(false);
        }, true);
        const resize = subscribeWindowEvent('resize', () => { setOpen(false); });
        return () => { outside(); scroll(); resize(); };
    }, [open]);
    return <div className={className} ref={anchor} onMouseEnter={show} onMouseLeave={leave}>
        {preview}
        <button className="model-details-trigger" type="button" aria-expanded={open} aria-controls={open ? id : undefined}
            onClick={() => { if (open) close(); else show(); }} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); show(); } }}
            onBlur={event => { if (!(event.relatedTarget instanceof Node) || !popup.current?.contains(event.relatedTarget)) close(); }}>
            {summary}
        </button>
        {open && position && portalTarget && createPortal(<div id={id} ref={popup} className="model-details-popover" style={position}
            onMouseEnter={cancelClose} onMouseLeave={leave}>
            {children()}
        </div>, portalTarget)}
    </div>;
}
