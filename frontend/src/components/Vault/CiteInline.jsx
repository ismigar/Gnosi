import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from '../../shared/api/legacy-http';
import { WikilinkHoverPreview } from './WikilinkHoverPreview';
import { VaultEditorContext } from './VaultEditorContext';
import { recursosPageToCsl, renderInlineCitation } from './cslEngine';

// Cache local citation key → { id, page, cslItem } (5 min TTL).
const KEY_CACHE = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const HOVER_OPEN_DELAY = 450;
const HOVER_CLOSE_DELAY = 180;

function readCache(key) {
    const entry = KEY_CACHE.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
        KEY_CACHE.delete(key);
        return undefined;
    }
    return entry.value;
}

function writeCache(key, value) {
    KEY_CACHE.set(key, { ts: Date.now(), value });
}

/**
 * Resolves a citation key. Returns `{ id, page, cslItem }` or null if not found.
 * For the formatted render, GET the full page from the backend (not just the id)
 * because we can extract the CSL-JSON locally.
 */
async function resolveCitationKey(key) {
    const cached = readCache(key);
    if (cached !== undefined) return cached;
    try {
        const r = await axios.get('/api/vault/resolve-by-citation-key', { params: { key } });
        const id = r?.data?.id;
        if (!id) {
            writeCache(key, null);
            return null;
        }
        // We need the complete metadata for the CSL render. A single call
        // more (the page). Cached for 5 min in the same map for efficiency.
        try {
            const page = await axios.get(`/api/vault/pages/${id}`);
            const cslItem = recursosPageToCsl(page.data);
            const value = { id, page: page.data, cslItem };
            writeCache(key, value);
            return value;
        } catch {
            // If the GET fails, we return only the id so that the click and the
            // hover still work (no formatted render).
            const value = { id, page: null, cslItem: null };
            writeCache(key, value);
            return value;
        }
    } catch {
        writeCache(key, null);
        return null;
    }
}

/**
 * Renders a citation `[@key]` in the BlockEditor. Same pattern as WikilinkInline:
 *  - Click → opens the Resources page corresponding to the citation key
 *  - Hover → preview reusing `WikilinkHoverPreview` once the id is resolved
 *  - Cmd+Click → new tab; Shift+Click → split-view
 *
 * Style: distinct chip (secondary color, `@` prefix) to differentiate
 * from wikilinks (which are primary blue).
 *
 * When the citation doesn't resolve (key not found in the Vault), it shows red with
 * a tooltip indicating the problem — the user knows they need to check it.
 */
export const CiteInline = ({ citationKey }) => {
    const ctx = useContext(VaultEditorContext) || {};
    const onOpenInCurrentTab = ctx.onOpenInCurrentTab || ctx.onOpenPage || null;
    const onOpenInNewTab = ctx.onOpenInNewTab || ctx.onOpenPage || null;
    const onOpenParallel = ctx.onOpenParallel || null;

    const spanRef = useRef(null);
    const openTimerRef = useRef(null);
    const closeTimerRef = useRef(null);
    // undefined = loading, null = not found, { id, page, cslItem } = ok
    const [resolved, setResolved] = useState(undefined);
    const [formatted, setFormatted] = useState(null);  // HTML string when available
    const [hoverActive, setHoverActive] = useState(false);
    const [anchorRect, setAnchorRect] = useState(null);

    // Citation style and locale come from the context (set by the page via
    // frontmatter, or the global default). Without a style, "raw" mode (shows @key).
    const cslStyle = ctx.cslStyle || 'apa';
    const cslLocale = ctx.cslLocale || 'en-US';

    useEffect(() => {
        let cancelled = false;
        setResolved(undefined);
        setFormatted(null);
        if (!citationKey) return undefined;
        (async () => {
            const value = await resolveCitationKey(citationKey);
            if (cancelled) return;
            setResolved(value);
            // Formatted render if we have CSL-JSON
            if (value?.cslItem) {
                try {
                    const items = { [value.cslItem.id]: value.cslItem };
                    const html = await renderInlineCitation(value.cslItem.id, items, cslStyle, cslLocale);
                    if (!cancelled) setFormatted(html);
                } catch (err) {
                    console.warn('cite render failed', err);
                }
            }
        })();
        return () => { cancelled = true; };
    }, [citationKey, cslStyle, cslLocale]);

    const resolvedId = resolved?.id;

    useEffect(() => () => {
        if (openTimerRef.current) clearTimeout(openTimerRef.current);
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    }, []);

    const cancelTimers = () => {
        if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = null; }
        if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    };

    const callOpen = useCallback((mode) => {
        if (!resolvedId) return;
        if (mode === 'parallel' && onOpenParallel) return onOpenParallel(resolvedId);
        if (mode === 'newTab' && onOpenInNewTab) return onOpenInNewTab(resolvedId);
        if (onOpenInCurrentTab) onOpenInCurrentTab(resolvedId);
        else if (onOpenInNewTab) onOpenInNewTab(resolvedId);
        else if (onOpenParallel) onOpenParallel(resolvedId);
    }, [resolvedId, onOpenInCurrentTab, onOpenInNewTab, onOpenParallel]);

    const handleClick = (e) => {
        if (e.button === 2) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        cancelTimers();
        setHoverActive(false);
        setAnchorRect(null);
        if (!resolvedId) return;
        if (e.button === 1) return callOpen('newTab');
        if (e.shiftKey) return callOpen('parallel');
        if (e.metaKey || e.ctrlKey) return callOpen('newTab');
        callOpen('sameTab');
    };

    const handleMouseEnter = () => {
        cancelTimers();
        if (!resolvedId) return;
        const rect = spanRef.current?.getBoundingClientRect() || null;
        openTimerRef.current = setTimeout(() => {
            setAnchorRect(rect);
            setHoverActive(true);
        }, HOVER_OPEN_DELAY);
    };

    const handleMouseLeave = () => {
        cancelTimers();
        closeTimerRef.current = setTimeout(() => {
            setHoverActive(false);
            setAnchorRect(null);
        }, HOVER_CLOSE_DELAY);
    };

    const handlePopupEnter = () => cancelTimers();
    const handlePopupLeave = () => {
        cancelTimers();
        closeTimerRef.current = setTimeout(() => {
            setHoverActive(false);
            setAnchorRect(null);
        }, HOVER_CLOSE_DELAY);
    };

    const stopBubble = (e) => {
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    };

    // Estats visuals:
    //   - loading (undefined): gray, indicates it is still resolving
    //   - resolved (object): teal + cursor pointer; shows CSL format if available
    //   - unresolved (null): red with tooltip
    const isLoading = resolved === undefined;
    const isMissing = resolved === null;
    const cls = [
        'cite-inline px-1 rounded-sm cursor-pointer transition-all',
        // The formatted text (Turkle, 2011) uses natural style; the raw @key, font-mono.
        formatted ? 'text-[0.95em]' : 'font-mono text-[0.9em]',
        isLoading
            ? 'text-[var(--text-tertiary)] bg-[var(--bg-secondary)]/50'
            : isMissing
                ? 'text-red-500 bg-red-50 dark:bg-red-900/20 line-through'
                : 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30',
    ].join(' ');

    const title = isMissing
        ? `Citació no trobada: @${citationKey}`
        : isLoading
            ? `Resolent @${citationKey}…`
            : `@${citationKey} — Obre la referència`;

    // Contingut visible: text formatat (Turkle, 2011) si disponible; raw @key
    // otherwise. If the user is still editing, the formatting provides context;
    // if they want to see/edit the raw key, the tooltip shows it to them.
    const displayContent = formatted
        ? <span dangerouslySetInnerHTML={{ __html: formatted }} />
        : `@${citationKey}`;

    return (
        <>
            <span
                ref={spanRef}
                className={cls}
                title={title}
                data-citation-key={citationKey}
                onMouseDown={stopBubble}
                onMouseUp={stopBubble}
                onClick={handleClick}
                onAuxClick={handleClick}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                style={{ pointerEvents: 'auto' }}
                // contentEditable=false so the chip is atomic within
                // the BlockEditor (the user deletes it with Backspace like
                // unit, doesn't go inside to modify the content).
                contentEditable={false}
            >
                {displayContent}
            </span>
            {hoverActive && resolvedId && (
                <WikilinkHoverPreview
                    pageId={resolvedId}
                    anchorRect={anchorRect}
                    onMouseEnter={handlePopupEnter}
                    onMouseLeave={handlePopupLeave}
                />
            )}
        </>
    );
};

export default CiteInline;
