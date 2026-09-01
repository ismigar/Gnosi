import { useLayoutEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { subscribeWindowEvent } from '../../../../../shared/platform/browser-events';
import type { PropertyDropdownPortalProps } from './types';

export const PropertyDropdownPortal = ({ anchorRef, children }: PropertyDropdownPortalProps) => {
    const [position, setPosition] = useState<CSSProperties | null>(null);

    useLayoutEffect(() => {
        let frame = 0;
        const updatePosition = () => {
            const anchor = anchorRef.current;
            if (!anchor) {
                frame = requestAnimationFrame(updatePosition);
                return;
            }
            const rect = anchor.getBoundingClientRect();
            const maxHeight = 300;
            const spaceBelow = window.innerHeight - rect.bottom;
            const spaceAbove = rect.top;
            const opensUpward = spaceBelow < Math.min(maxHeight, 160) && spaceAbove > spaceBelow;
            const availableSpace = Math.max(80, (opensUpward ? spaceAbove : spaceBelow) - 8);
            setPosition({
                left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
                width: rect.width,
                top: opensUpward ? undefined : rect.bottom + 8,
                bottom: opensUpward ? window.innerHeight - rect.top + 8 : undefined,
                maxHeight: Math.min(maxHeight, availableSpace),
            });
        };
        updatePosition();
        const stopScroll = subscribeWindowEvent('scroll', updatePosition, true);
        const stopResize = subscribeWindowEvent('resize', updatePosition);
        return () => {
            if (frame) cancelAnimationFrame(frame);
            stopScroll();
            stopResize();
        };
    }, [anchorRef]);

    if (!position) return null;
    return createPortal(
        <div
            data-property-dropdown
            className="flex flex-col overflow-y-auto custom-scrollbar border border-[var(--border-primary)] rounded-xl bg-[var(--bg-primary)] p-2 shadow-xl animate-in fade-in zoom-in-95 duration-100"
            style={{ position: 'fixed', zIndex: 'var(--z-popover)', ...position }}
        >
            {children}
        </div>,
        document.body,
    );
};
