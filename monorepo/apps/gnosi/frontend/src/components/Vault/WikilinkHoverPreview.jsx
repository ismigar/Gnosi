import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconRenderer } from './IconRenderer';

// Preview cache shared across instances. Avoids refetching when the user
// repeatedly hovers over the same wikilinks (timeline, backlinks).
const PREVIEW_CACHE = new Map();
const CACHE_MAX = 100;
const CACHE_TTL_MS = 5 * 60 * 1000;

function readCache(id) {
    const entry = PREVIEW_CACHE.get(id);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
        PREVIEW_CACHE.delete(id);
        return null;
    }
    return entry.data;
}

function writeCache(id, data) {
    if (PREVIEW_CACHE.size >= CACHE_MAX) {
        const firstKey = PREVIEW_CACHE.keys().next().value;
        if (firstKey) PREVIEW_CACHE.delete(firstKey);
    }
    PREVIEW_CACHE.set(id, { ts: Date.now(), data });
}

/**
 * Invalidates the cached preview of a page (or the entire cache if no id is passed).
 * Must be called when the page has changed to avoid showing "Empty page"
 * or a stale excerpt in later hovers until the 5 min TTL expires.
 */
// eslint-disable-next-line react-refresh/only-export-components -- helper exposed next to the component because they share the same local cache
export function invalidatePreviewCache(pageId) {
    if (!pageId) {
        PREVIEW_CACHE.clear();
        return;
    }
    PREVIEW_CACHE.delete(pageId);
}

// Invalidation via a DOM event so that any layer (axios interceptor,
// "reload" buttons, refresh cron) can request it without having
// importing this module. detail.pageId is optional → if missing, clears everything.
if (typeof window !== 'undefined') {
    window.addEventListener('gnosi:invalidatePreview', (ev) => {
        invalidatePreviewCache(ev?.detail?.pageId);
    });
}

/**
 * Wikipedia-style popup for wikilink hover.
 * Shows title, icon (if present), and excerpt (first paragraph).
 *
 * Props:
 *  - pageId: resolved ID (UUID or normalized title) of the page
 *  - anchorRect: DOMRect of the wikilink that triggered the hover
 *  - onMouseEnter / onMouseLeave: callbacks to keep the popup alive while
 *    the cursor is over it (delegated to the parent component for the close timeout).
 */
export const WikilinkHoverPreview = ({ pageId, anchorRect, onMouseEnter, onMouseLeave }) => {
    const { t } = useTranslation();
    const [data, setData] = useState(() => readCache(pageId));
    const [loading, setLoading] = useState(!data);
    const [error, setError] = useState(false);
    const [popupPos, setPopupPos] = useState(null);
    const popupRef = useRef(null);

    useEffect(() => {
        if (!pageId) return;
        const cached = readCache(pageId);
        if (cached) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from cache on prop change
            setData(cached);
            setLoading(false);
            setError(false);
            return;
        }
        let cancelled = false;
        setData(null);
        setLoading(true);
        setError(false);
        axios.get(`/api/vault/pages/${encodeURIComponent(pageId)}/preview`)
            .then(res => {
                if (cancelled) return;
                writeCache(pageId, res.data);
                setData(res.data);
                setLoading(false);
            })
            .catch(() => {
                if (cancelled) return;
                setError(true);
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [pageId]);

    // Positioning: below the wikilink by default; if it doesn't fit, above.
    // useLayoutEffect to avoid a visible flash with the wrong position.
    useLayoutEffect(() => {
        if (!anchorRect || !popupRef.current) return;
        const popup = popupRef.current;
        const rect = popup.getBoundingClientRect();
        const PADDING = 8;
        let top = anchorRect.bottom + PADDING;
        let left = anchorRect.left;
        if (top + rect.height > window.innerHeight - PADDING) {
            top = Math.max(PADDING, anchorRect.top - rect.height - PADDING);
        }
        if (left + rect.width > window.innerWidth - PADDING) {
            left = Math.max(PADDING, window.innerWidth - rect.width - PADDING);
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- compute position from anchor after layout
        setPopupPos({ top, left });
    }, [anchorRect, data, loading, error]);

    if (!anchorRect) return null;

    const popup = (
        <div
            ref={popupRef}
            className="fixed z-[9999] w-[340px] max-h-[260px] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700/60 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            style={popupPos
                ? { top: popupPos.top, left: popupPos.left, opacity: 1, pointerEvents: 'auto' }
                : { top: -9999, left: -9999, opacity: 0, pointerEvents: 'none' }
            }
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            {!loading && !error && data?.cover && (
                <div
                    className="h-16 bg-cover bg-center"
                    style={{ backgroundImage: `url("${data.cover}")` }}
                />
            )}
            <div className="p-4">
                {loading && (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                        <div className="w-3 h-3 border-2 border-slate-300 border-t-[var(--gnosi-primary)] rounded-full animate-spin" />
                        <span>{t('common.loading', "Loading...")}</span>
                    </div>
                )}
                {error && (
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                        <FileText size={14} />
                        <span>{t('wikilink.preview_error', "Could not load the page")}</span>
                    </div>
                )}
                {!loading && !error && data && (
                    <>
                        <div className="flex items-center gap-2 mb-2">
                            {data.icon ? (
                                <IconRenderer icon={data.icon} size={16} className="flex-shrink-0" />
                            ) : (
                                <FileText size={14} className="text-slate-400 flex-shrink-0" />
                            )}
                            <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
                                {data.title || t('common.untitled', "Untitled")}
                            </h4>
                        </div>
                        {data.excerpt ? (
                            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-6 whitespace-pre-line">
                                {data.excerpt}
                            </p>
                        ) : (
                            <p className="text-xs text-slate-400 italic">{t('wikilink.empty_page', "Empty page")}</p>
                        )}
                    </>
                )}
            </div>
        </div>
    );

    return typeof document !== 'undefined' ? createPortal(popup, document.body) : null;
};

export default WikilinkHoverPreview;
