import { useCallback, useRef, useState, type MouseEvent, type ReactNode, type FocusEvent, type KeyboardEvent } from 'react';
import { createPanePortal as createPortal } from '../createPanePortal';

const PREVIEW_SIZE = 320;
const VIEWPORT_MARGIN = 8;

interface PreviewPosition {
    readonly left: number;
    readonly top: number;
}

export interface ImageHoverPreviewProps {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly alt?: string;
    readonly href?: string;
    readonly src: string;
    readonly thumbClassName?: string;
}

export const ImageHoverPreview = ({
    src,
    children,
    className = 'inline-flex items-center',
    alt = '',
    href,
    thumbClassName = 'w-14 h-10 object-cover rounded border border-[var(--border-primary)]',
}: ImageHoverPreviewProps) => {
    const [activeSource, setActiveSource] = useState('');
    const [pos, setPos] = useState<PreviewPosition>({ top: 0, left: 0 });
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    const anchorRef = useRef<HTMLElement | null>(null);
    const setAnchor = useCallback((node: HTMLElement | null): void => {
        anchorRef.current = node;
    }, []);

    const updatePosition = useCallback(() => {
        if (!anchorRef.current) return;
        const rect = anchorRef.current.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let left = rect.right + VIEWPORT_MARGIN;
        if (left + PREVIEW_SIZE + VIEWPORT_MARGIN > vw) {
            left = rect.left - PREVIEW_SIZE - VIEWPORT_MARGIN;
        }
        if (left < VIEWPORT_MARGIN) {
            left = Math.max(VIEWPORT_MARGIN, vw - PREVIEW_SIZE - VIEWPORT_MARGIN);
        }

        let top = rect.top + rect.height / 2 - PREVIEW_SIZE / 2;
        if (top + PREVIEW_SIZE + VIEWPORT_MARGIN > vh) {
            top = vh - PREVIEW_SIZE - VIEWPORT_MARGIN;
        }
        if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;

        setPos({ top, left });
    }, []);

    const handleEnter = useCallback(() => {
        updatePosition();
        if (activeSource !== src || failed) {
            setFailed(false);
            setLoaded(false);
        }
        setActiveSource(src);
    }, [activeSource, failed, src, updatePosition]);

    const handleLeave = useCallback(() => {
        setActiveSource('');
        setLoaded(false);
    }, []);

    const stopLinkClick = useCallback((event: MouseEvent<HTMLAnchorElement>): void => {
        event.stopPropagation();
    }, []);

    const thumbnail = children ?? <img src={src} alt={alt} className={thumbClassName} />;
    const triggerEvents = {
        onMouseEnter: handleEnter,
        onMouseLeave: handleLeave,
        onFocus: handleEnter,
        onBlur: (event: FocusEvent<HTMLElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget)) handleLeave();
        },
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
            if (event.key === 'Escape' && activeSource === src && src && !failed) {
                event.stopPropagation();
                handleLeave();
            }
        },
    };

    return (
        <>
            {href ? (
                <a
                    ref={setAnchor}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className={className}
                    onClick={stopLinkClick}
                    {...triggerEvents}
                >
                    {thumbnail}
                </a>
            ) : (
                <span
                    ref={setAnchor}
                    tabIndex={children ? undefined : 0}
                    className={className}
                    {...triggerEvents}
                >
                    {thumbnail}
                </span>
            )}
            {activeSource === src && Boolean(src) && !failed && createPortal(
                <div
                    style={{
                        position: 'fixed',
                        top: pos.top,
                        left: pos.left,
                        width: `min(${String(PREVIEW_SIZE)}px, calc(100vw - ${String(VIEWPORT_MARGIN * 2)}px))`,
                        height: `min(${String(PREVIEW_SIZE)}px, calc(100vh - ${String(VIEWPORT_MARGIN * 2)}px))`,
                        zIndex: 'var(--z-popover)',
                        pointerEvents: 'none',
                    }}
                    className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl overflow-hidden"
                >
                    {!loaded && (
                        <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--text-tertiary)]">
                            …
                        </div>
                    )}
                    <img
                        onError={() => { setFailed(true); }}
                        src={src}
                        alt={alt}
                        onLoad={() => {
                            setLoaded(true);
                        }}
                        className="w-full h-full object-contain bg-[var(--bg-secondary)]"
                    />
                </div>,
                document.body,
            )}
        </>
    );
};

export default ImageHoverPreview;
