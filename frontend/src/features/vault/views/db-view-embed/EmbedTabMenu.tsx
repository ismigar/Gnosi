import { useLayoutEffect, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { PanePortal } from '../../../../shared/ui/PanePortal';
import { browserDocumentBody, subscribeWindowEvent } from '../../../../shared/platform/browser-events';

export function EmbedTabMenu({ anchorRef, opensUpward, onClose, children }: {
    anchorRef: RefObject<HTMLButtonElement | null>;
    opensUpward: boolean;
    onClose: () => void;
    children: ReactNode;
}) {
    const [position, setPosition] = useState<CSSProperties | null>(null);
    useLayoutEffect(() => {
        const updatePosition = () => {
            const anchor = anchorRef.current;
            if (!anchor) return;
            const rect = anchor.getBoundingClientRect();
            const width = Math.min(224, window.innerWidth - 16);
            setPosition({
                width,
                left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
                top: opensUpward ? undefined : rect.bottom + 4,
                bottom: opensUpward ? window.innerHeight - rect.top + 4 : undefined,
                maxHeight: Math.max(80, (opensUpward ? rect.top : window.innerHeight - rect.bottom) - 12),
            });
        };
        updatePosition();
        const stopScroll = subscribeWindowEvent('scroll', updatePosition, true);
        const stopResize = subscribeWindowEvent('resize', updatePosition);
        return () => { stopScroll(); stopResize(); };
    }, [anchorRef, opensUpward]);
    if (!position) return null;
    return <PanePortal container={browserDocumentBody()}>
        <div className="fixed inset-0 z-[var(--z-overlay)]" onClick={event => { event.stopPropagation(); onClose(); }} />
        <div data-embed-tab-menu
            className="fixed z-[var(--z-popover)] overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg py-1 text-xs text-[var(--text-primary)] font-normal"
            style={position}>
            {children}
        </div>
    </PanePortal>;
}
