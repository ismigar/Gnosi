import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const PREVIEW_SIZE = 320;
const VIEWPORT_MARGIN = 8;

export const ImageHoverPreview = ({
    src,
    alt = '',
    href,
    thumbClassName = 'w-14 h-10 object-cover rounded border border-[var(--border-primary)]',
}) => {
    const [show, setShow] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const [loaded, setLoaded] = useState(false);
    const anchorRef = useRef(null);

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
        setShow(true);
    }, [updatePosition]);

    const handleLeave = useCallback(() => {
        setShow(false);
        setLoaded(false);
    }, []);

    const linkProps = href
        ? {
            href,
            target: '_blank',
            rel: 'noreferrer',
            onClick: (e) => e.stopPropagation(),
        }
        : {};

    const Tag = href ? 'a' : 'span';

    return (
        <>
            <Tag
                ref={anchorRef}
                className="inline-flex items-center"
                onMouseEnter={handleEnter}
                onMouseLeave={handleLeave}
                {...linkProps}
            >
                <img src={src} alt={alt} className={thumbClassName} loading="lazy" />
            </Tag>
            {show && createPortal(
                <div
                    style={{
                        position: 'fixed',
                        top: pos.top,
                        left: pos.left,
                        width: PREVIEW_SIZE,
                        height: PREVIEW_SIZE,
                        zIndex: 9999,
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
                        src={src}
                        alt={alt}
                        onLoad={() => setLoaded(true)}
                        className="w-full h-full object-contain bg-[var(--bg-secondary)]"
                    />
                </div>,
                document.body,
            )}
        </>
    );
};

export default ImageHoverPreview;
