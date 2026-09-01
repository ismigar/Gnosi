import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { resolveVaultTitle } from '../../shared/api/vaults';
import { WikilinkHoverPreview } from './WikilinkHoverPreview';
import { WikilinkContextMenu } from './WikilinkContextMenu';
import { VaultEditorContext } from './VaultEditorContext';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOVER_OPEN_DELAY = 450;
const HOVER_CLOSE_DELAY = 180;

// Cache of title → UUID resolutions shared across instances. Avoids
// repeated requests to the backend when the same wikilink appears many
// times on the page (5min TTL).
const TITLE_RESOLVE_CACHE = new Map();
const TITLE_CACHE_TTL_MS = 5 * 60 * 1000;

function readResolveCache(key) {
    const entry = TITLE_RESOLVE_CACHE.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > TITLE_CACHE_TTL_MS) {
        TITLE_RESOLVE_CACHE.delete(key);
        return undefined;
    }
    return entry.value;
}

function writeResolveCache(key, value) {
    TITLE_RESOLVE_CACHE.set(key, { ts: Date.now(), value });
}

/**
 * Resolves a wikilink target to a page_id using the local idToTitle lookup.
 *  - If it's a UUID, returns it directly (removing a possible #section).
 *  - If it's a title, does a reverse lookup in idToTitle (case-insensitive).
 *  - If nothing is found, returns the original target (requires a backend fallback).
 */
function resolveTargetLocal(raw, idToTitle) {
    if (!raw) return raw;
    const hashIdx = raw.indexOf('#');
    const base = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    if (!base) return raw;
    if (UUID_RE.test(base)) return base;
    const lower = base.toLowerCase().trim();
    for (const [id, title] of Object.entries(idToTitle || {})) {
        if (String(title || '').toLowerCase().trim() === lower) {
            return id;
        }
    }
    return base;
}

/**
 * Resolves asynchronously with a fallback to the backend (`/api/vault/resolve-by-title`).
 * Useful when `idToTitle` is empty or stale (right after a move,
 * direct navigation via URL, etc.). Returns the UUID or the original target
 * if the backend doesn't have a match either.
 */
async function resolveTargetWithBackend(raw, idToTitle) {
    const local = resolveTargetLocal(raw, idToTitle);
    if (!local || UUID_RE.test(local)) return local;
    const cacheKey = local.toLowerCase().trim();
    const cached = readResolveCache(cacheKey);
    if (cached !== undefined) return cached || local;
    try {
        const result = await resolveVaultTitle(local);
        const id = result.id;
        writeResolveCache(cacheKey, id || null);
        return id || local;
    } catch {
        writeResolveCache(cacheKey, null);
        return local;
    }
}

/**
 * Renderer for an inline wikilink with:
 *  - Click → open in current tab (replaces)
 *  - Cmd/Ctrl+Click → open in new tab
 *  - Shift+Click → open in parallel pane
 *  - Hover → preview popup with excerpt (Wikipedia style)
 *  - Right-click → context menu with the 3 options
 *
 *  Fallback: if onOpenInCurrentTab/onOpenInNewTab is not passed, reuses
 *  onOpenParallel to maintain compatibility with older instances
 *  (PageViewModal, etc.) that only pass onOpenParallel.
 */
export const WikilinkInline = ({ title, target, idToTitle: idToTitleProp, onOpenInCurrentTab: onOpenInCurrentTabProp, onOpenInNewTab: onOpenInNewTabProp, onOpenParallel: onOpenParallelProp }) => {
    // CRITICAL: the BlockNote schema freezes when the editor is created (it is not
    // recreated every time globalIndex changes). If we read `idToTitle` from
    // contextValue via closure inside the spec, it goes stale (size 0). That's why
    // we read from the context LIVE (useContext) and only fall back to props if the
    // context isn't available (e.g. isolated tests).
    const ctx = useContext(VaultEditorContext) || {};
    const idToTitle = idToTitleProp && Object.keys(idToTitleProp).length > 0 ? idToTitleProp : (ctx.idToTitle || {});
    const onOpenInCurrentTab = onOpenInCurrentTabProp || ctx.onOpenInCurrentTab || null;
    const onOpenInNewTab = onOpenInNewTabProp || ctx.onOpenInNewTab || ctx.onOpenPage || null;
    const onOpenParallel = onOpenParallelProp || ctx.onOpenParallel || null;

    const spanRef = useRef(null);
    const openTimerRef = useRef(null);
    const closeTimerRef = useRef(null);
    const [hoverActive, setHoverActive] = useState(false);
    const [anchorRect, setAnchorRect] = useState(null);
    const [menuPos, setMenuPos] = useState(null);

    // Local synchronous resolution (for the hover preview, which can't be async).
    const resolvedId = resolveTargetLocal(target, idToTitle);

    const callOpen = useCallback(async (mode) => {
        if (!target) return;
        // For clicks/menu: if the local resolution returned a title
        // (idToTitle doesn't recognize it) we do a quick fallback to the backend before
        // calling the handler. This way the wikilink isn't "dead" when globalIndex
        // is empty or stale (for example right after a move).
        let id = resolvedId || target;
        if (!UUID_RE.test(id)) {
            id = await resolveTargetWithBackend(target, idToTitle);
        }
        if (!id) return;
        if (mode === 'parallel' && onOpenParallel) {
            onOpenParallel(id);
            return;
        }
        if (mode === 'newTab' && onOpenInNewTab) {
            onOpenInNewTab(id);
            return;
        }
        if (mode === 'sameTab' && onOpenInCurrentTab) {
            onOpenInCurrentTab(id);
            return;
        }
        // Fallbacks: if the embedder doesn't provide the specific handler,
        // we fall back to the available ones so as not to leave a "dead" click.
        if (onOpenInCurrentTab) onOpenInCurrentTab(id);
        else if (onOpenInNewTab) onOpenInNewTab(id);
        else if (onOpenParallel) onOpenParallel(id);
    }, [resolvedId, target, idToTitle, onOpenInCurrentTab, onOpenInNewTab, onOpenParallel]);

    // Cancel·la timers pendents en desmuntatge.
    useEffect(() => () => {
        if (openTimerRef.current) clearTimeout(openTimerRef.current);
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    }, []);

    const cancelTimers = () => {
        if (openTimerRef.current) {
            clearTimeout(openTimerRef.current);
            openTimerRef.current = null;
        }
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    };

    const handleMouseEnter = () => {
        cancelTimers();
        if (menuPos) return; // menu open: don't show hover
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

    // When the cursor enters the popup, keeps it open.
    const handlePopupEnter = () => {
        cancelTimers();
    };
    const handlePopupLeave = () => {
        cancelTimers();
        closeTimerRef.current = setTimeout(() => {
            setHoverActive(false);
            setAnchorRect(null);
        }, HOVER_CLOSE_DELAY);
    };

    const handleClick = (e) => {
        // Ignore the right button: `onAuxClick` also fires on right-click
        // and, without filtering, it would navigate to "sameTab", closing the context menu.
        // 0 = esquerre, 1 = mig, 2 = dret.
        if (typeof e.button === 'number' && e.button === 2) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
        }
        // Closes hover/menu before navigating
        cancelTimers();
        setHoverActive(false);
        setAnchorRect(null);
        setMenuPos(null);
        if (!target) return;
        // Middle-click → new tab (like browsers do).
        if (e.button === 1) {
            callOpen('newTab');
            return;
        }
        if (e.shiftKey) {
            callOpen('parallel');
        } else if (e.metaKey || e.ctrlKey) {
            callOpen('newTab');
        } else {
            callOpen('sameTab');
        }
    };

    const stopBubble = (e) => {
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
        }
    };

    const handleContextMenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelTimers();
        setHoverActive(false);
        setAnchorRect(null);
        setMenuPos({ x: e.clientX, y: e.clientY });
    };

    const closeMenu = () => setMenuPos(null);

    return (
        <>
            <span
                ref={spanRef}
                className="wikilink-inline text-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary-hover)] underline decoration-[var(--gnosi-primary)]/30 underline-offset-4 cursor-pointer transition-all font-semibold"
                data-wikilink-target={target}
                onMouseDown={stopBubble}
                onMouseUp={stopBubble}
                onClick={handleClick}
                onAuxClick={handleClick}
                onContextMenu={handleContextMenu}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                style={{ pointerEvents: 'auto' }}
            >
                {title}
            </span>
            {hoverActive && resolvedId && !menuPos && (
                <WikilinkHoverPreview
                    pageId={resolvedId}
                    anchorRect={anchorRect}
                    onMouseEnter={handlePopupEnter}
                    onMouseLeave={handlePopupLeave}
                />
            )}
            <WikilinkContextMenu
                isOpen={Boolean(menuPos)}
                position={menuPos}
                onClose={closeMenu}
                onOpenSameTab={() => callOpen('sameTab')}
                onOpenNewTab={() => callOpen('newTab')}
                onOpenParallel={() => callOpen('parallel')}
            />
        </>
    );
};

export default WikilinkInline;
