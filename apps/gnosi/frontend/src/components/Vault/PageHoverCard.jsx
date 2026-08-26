import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { FileText, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconRenderer } from './IconRenderer';
import { VaultMarkdown } from './VaultMarkdown';
import {
    adaptiveHoverPreviewStyle,
    isHoverPreviewScrollable,
    positionHoverPreview,
    scrollHoverPreviewByKey,
} from './hoverPreviewLayout';

// Cache of COMPLETE previews (body_md). Separate from the one in WikilinkHoverPreview
// because the payload is much larger (full body) → fewer entries and the same
// invalidation via the `gnosi:invalidatePreview` DOM event.
const FULL_CACHE = new Map();
const CACHE_MAX = 40;
const CACHE_TTL_MS = 5 * 60 * 1000;

function readCache(id) {
    const entry = FULL_CACHE.get(id);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
        FULL_CACHE.delete(id);
        return null;
    }
    return entry.data;
}

function writeCache(id, data) {
    if (FULL_CACHE.size >= CACHE_MAX) {
        const firstKey = FULL_CACHE.keys().next().value;
        if (firstKey) FULL_CACHE.delete(firstKey);
    }
    FULL_CACHE.set(id, { ts: Date.now(), data });
}

if (typeof window !== 'undefined') {
    window.addEventListener('gnosi:invalidatePreview', (ev) => {
        const id = ev?.detail?.pageId;
        if (!id) FULL_CACHE.clear();
        else FULL_CACHE.delete(id);
    });
}

const PADDING = 8;
const CARD_STYLE = adaptiveHoverPreviewStyle({
    minWidth: 300,
    maxWidth: 520,
    maxHeight: 520,
    margin: PADDING,
});

// Metadata fields that are NOT shown as properties in the bodyless preview
// (internal or already represented elsewhere in the card).
const HIDDEN_META_KEYS = new Set([
    'title', 'id', 'table_id', 'database_table_id', 'icon', 'cover',
]);
const WEB_URL_KEYS = ['drupal_url', 'Drupal URL', 'url', 'URL', 'enllaç', 'link'];

function pickWebUrl(meta) {
    if (!meta) return null;
    for (const k of WEB_URL_KEYS) {
        const v = meta[k];
        if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
    }
    return null;
}

function formatMetaValue(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(formatMetaValue).filter(Boolean).join(', ');
    if (typeof v === 'object') return String(v.src || v.title || v.alt || '');
    // Wikilinks `[[text|id]]` / `[[text]]` → only the visible text.
    return String(v).replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1').trim();
}

// A "relation" value (uuid or wikilink with alias): used to hide fields
// of relation type by their value, regardless of the column name.
function looksLikeRelationValue(v) {
    const arr = Array.isArray(v) ? v : [v];
    return arr.length > 0 && arr.every(x => typeof x === 'string' && (
        /^\s*\[\[.+\|.+\]\]\s*$/.test(x) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x.trim())
    ));
}

// Properties with a value from the metadata, for previewing a record with no body.
function visibleProps(meta) {
    if (!meta || typeof meta !== 'object') return [];
    return Object.entries(meta)
        .filter(([k, v]) => !HIDDEN_META_KEYS.has(k)
            && !k.startsWith('drupal_')   // Drupal sync ids/urls
            && !looksLikeRelationValue(v) // relacions (uuid/wikilink): mostrarien uuids crus
            && !k.endsWith('_manual')     // internal flags (e.g. Imatge_manual)
            && k !== 'Drupal URL' && k !== 'Drupal NID')
        .map(([k, v]) => [k, formatMetaValue(v)])
        .filter(([, v]) => v && v.length > 0)
        .slice(0, 10);
}

/**
 * Preview pop-up for the FULL content of a Vault page.
 * Shows an optional cover, a fixed header (icon + title), and the Markdown body
 * with scroll. Designed for hovering over a record's title and operable with
 * the keyboard (Quick Look): when opened via keyboard it focuses the body so ↑↓ / Page Up
 * / Page Down scroll natively and Esc / Space close it.
 *
 * Props:
 *  - pageId: id of the page to preview.
 *  - anchorRect: DOMRect of the element that triggers the preview.
 *  - viaKeyboard: opened via keyboard → focuses the body on mount.
 *  - onClose: closes the card (Esc / Space inside the card).
 *  - onOpenPage: opens the full page (click on an image in the body).
 *  - onMouseEnter / onMouseLeave: keep the card alive while the mouse is over it.
 */
export const PageHoverCard = ({
    pageId,
    anchorRect,
    viaKeyboard = false,
    onClose,
    onOpenPage,
    onMouseEnter,
    onMouseLeave,
}) => {
    const { t } = useTranslation();
    const [data, setData] = useState(() => readCache(pageId));
    const [loading, setLoading] = useState(!data);
    const [error, setError] = useState(false);
    const [pos, setPos] = useState(null);
    const [meta, setMeta] = useState(null); // metadata for the preview without body (lazy fetch)
    const cardRef = useRef(null);
    const scrollRef = useRef(null);
    const prevFocusRef = useRef(null); // focus to restore when the mouse leaves the card

    useEffect(() => {
        if (!pageId) return undefined;
        const cached = readCache(pageId);
        if (cached) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from cache on prop change
            setData(cached);
            setLoading(false);
            setError(false);
            return undefined;
        }
        let cancelled = false;
        setData(null);
        setMeta(null);
        setLoading(true);
        setError(false);
        axios.get(`/api/vault/pages/${encodeURIComponent(pageId)}/preview?full=true`)
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

    // If the page has no body, we load the metadata (lazily) to show the
    // record's properties and the link to the original instead of "Empty page".
    useEffect(() => {
        if (!data || (data.body_md && String(data.body_md).trim())) return undefined;
        let cancelled = false;
        axios.get(`/api/vault/pages/${encodeURIComponent(pageId)}`)
            .then(res => { if (!cancelled) setMeta(res.data?.metadata || {}); })
            .catch(() => { if (!cancelled) setMeta({}); });
        return () => { cancelled = true; };
    }, [data, pageId]);

    // Positioning: below the anchor by default; if it doesn't fit, above; if
    // that doesn't fit either, anchored at the top with padding (the body's scroll does the rest).
    // useLayoutEffect to avoid a flash with the wrong position.
    useLayoutEffect(() => {
        if (!anchorRect || !cardRef.current) return;
        const rect = cardRef.current.getBoundingClientRect();
        setPos(positionHoverPreview(anchorRect, rect, {
            width: window.innerWidth,
            height: window.innerHeight,
        }, PADDING));
    }, [anchorRect, data, loading, error, meta]);

    // Quick Look: when opened via keyboard we focus the body so the arrow keys
    // scroll natively. The card is a portal OUTSIDE the table container, so
    // the global cell-navigation listener ignores it (it doesn't hijack keys).
    useEffect(() => {
        if (viaKeyboard && pos && scrollRef.current) {
            scrollRef.current.focus({ preventScroll: true });
        }
    }, [viaKeyboard, pos]);

    // The pointer may enter while the card still contains only the loading
    // state. Focus again after the full content arrives if it has become
    // scrollable without requiring the user to leave and re-enter the card.
    useEffect(() => {
        const card = cardRef.current;
        const element = scrollRef.current;
        if (!viaKeyboard && card?.matches(':hover') && element
            && !element.contains(document.activeElement) && isHoverPreviewScrollable(element)) {
            prevFocusRef.current = document.activeElement;
            element.focus({ preventScroll: true });
        }
    }, [data, loading, meta, pos, viaKeyboard]);

    if (!anchorRect) return null;

    const handleKeyDown = (e) => {
        if (scrollHoverPreviewByKey(scrollRef.current, e.key)) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (e.key === 'Escape' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            e.stopPropagation();
            onClose?.();
        }
        // ↑↓ / Page Up / Page Down / Home / End: we leave the native scroll of the focused body.
    };

    // Hover: when the mouse enters the card and the body overflows, we focus it so
    // the arrows / Page Up / Page Down / Home / End scroll natively (same as the
    // keyboard Quick Look). The focus stays INSIDE the portal, outside the container
    // of the table, so the cell-navigation listener ignores the keys
    // (it doesn't hijack them). On exit, we restore the previous focus so navigation
    // of cells resumes. We only focus if there's something to scroll, so as not to
    // steal focus from short records (where the arrows must keep navigating).
    const handleCardMouseEnter = () => {
        onMouseEnter?.();
        const el = scrollRef.current;
        if (el && !el.contains(document.activeElement) && isHoverPreviewScrollable(el)) {
            prevFocusRef.current = document.activeElement;
            el.focus({ preventScroll: true });
        }
    };
    const handleCardMouseLeave = () => {
        onMouseLeave?.();
        const el = scrollRef.current;
        if (el && el.contains(document.activeElement)) {
            const prev = prevFocusRef.current;
            prevFocusRef.current = null;
            // Restore focus to the previous element if it is genuinely focusable; if not
            // (typically the <body>, where `.focus()` is often a no-op), simply
            // remove focus from the card so the grid resumes navigation of
            // cells (focus falls to the <body>, whose listener does accept it).
            if (prev && prev !== document.body && prev.isConnected && typeof prev.focus === 'function') {
                prev.focus({ preventScroll: true });
            } else {
                el.blur();
            }
        }
    };

    const card = (
        <div
            ref={cardRef}
            role="dialog"
            aria-label={data?.title || t('common.untitled', "Untitled")}
            data-testid="page-hover-card"
            className="fixed z-[var(--z-popover)] flex flex-col bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700/60 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            style={pos
                ? { ...CARD_STYLE, top: pos.top, left: pos.left, opacity: 1, pointerEvents: 'auto' }
                : { ...CARD_STYLE, top: -9999, left: -9999, opacity: 0, pointerEvents: 'none' }
            }
            onMouseEnter={handleCardMouseEnter}
            onMouseLeave={handleCardMouseLeave}
            onKeyDown={handleKeyDown}
        >
            {!loading && !error && data?.cover && (
                <div
                    className="h-20 bg-cover bg-center shrink-0"
                    style={{ backgroundImage: `url("${data.cover}")` }}
                />
            )}
            {!loading && !error && data && (
                <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800 shrink-0">
                    {data.icon ? (
                        <IconRenderer icon={data.icon} size={18} className="flex-shrink-0" />
                    ) : (
                        <FileText size={15} className="text-slate-400 flex-shrink-0" />
                    )}
                    <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
                        {data.title || t('common.untitled', "Untitled")}
                    </h4>
                </div>
            )}
            <div
                ref={scrollRef}
                tabIndex={-1}
                className="min-w-0 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3 outline-none custom-scrollbar"
            >
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
                    (data.body_md && String(data.body_md).trim()) ? (
                        <div className="text-sm text-[var(--text-secondary)] leading-relaxed feed-md break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:[overflow-wrap:anywhere] [&_code]:whitespace-pre-wrap [&_code]:break-words [&_code]:[overflow-wrap:anywhere] [&_code]:overflow-x-hidden [&_table]:table [&_table]:w-full [&_table]:table-fixed [&_th]:break-words [&_th]:[overflow-wrap:anywhere] [&_td]:break-words [&_td]:[overflow-wrap:anywhere]">
                            <VaultMarkdown
                                md={data.body_md}
                                onActivate={() => onOpenPage?.(pageId)}
                                imageTitle={data.title}
                            />
                        </div>
                    ) : (
                        <div className="text-xs space-y-2">
                            {meta === null && (
                                <span className="text-slate-400 italic">{t('common.loading', "Loading...")}</span>
                            )}
                            {meta !== null && visibleProps(meta).length > 0 && (
                                <dl className="space-y-1.5">
                                    {visibleProps(meta).map(([k, v]) => (
                                        <div key={k} className="flex gap-2">
                                            <dt className="shrink-0 min-w-[84px] max-w-[40%] truncate text-slate-400 dark:text-slate-500">{k}</dt>
                                            <dd className="flex-1 text-slate-700 dark:text-slate-300 break-words [overflow-wrap:anywhere]">{v}</dd>
                                        </div>
                                    ))}
                                </dl>
                            )}
                            {meta !== null && visibleProps(meta).length === 0 && !pickWebUrl(meta) && (
                                <p className="text-slate-400 italic">{t('hovercard.no_content', "This record has no written content.")}</p>
                            )}
                            {meta !== null && pickWebUrl(meta) && (
                                <a
                                    href={pickWebUrl(meta)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1 pt-1 text-[var(--gnosi-primary)] hover:underline"
                                >
                                    <ExternalLink size={12} />
                                    {t('hovercard.view_on_web', "View the original on the web")}
                                </a>
                            )}
                        </div>
                    )
                )}
            </div>
        </div>
    );

    return typeof document !== 'undefined' ? createPortal(card, document.body) : null;
};

export default PageHoverCard;
