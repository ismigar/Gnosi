import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { WikilinkHoverPreview } from './WikilinkHoverPreview';
import { WikilinkContextMenu } from './WikilinkContextMenu';
import { VaultEditorContext } from './VaultEditorContext';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOVER_OPEN_DELAY = 450;
const HOVER_CLOSE_DELAY = 180;

// Cache de resolucions títol → UUID compartit entre instàncies. Evita
// peticions repetides al backend quan el mateix wikilink apareix moltes
// vegades a la pàgina (5min TTL).
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
 * Resol un target de wikilink a un page_id usant el lookup local idToTitle.
 *  - Si és UUID, retorna directament (eliminant possible #section).
 *  - Si és un títol, fa lookup invers a idToTitle (case-insensitive).
 *  - Si no troba res, retorna el target original (cal fallback a backend).
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
 * Resol async amb fallback al backend (`/api/vault/resolve-by-title`).
 * Útil quan `idToTitle` està buit o desactualitzat (just després d'un move,
 * navegació directa per URL, etc.). Retorna l'UUID o el target original
 * si tampoc el backend té coincidència.
 */
async function resolveTargetWithBackend(raw, idToTitle) {
    const local = resolveTargetLocal(raw, idToTitle);
    if (!local || UUID_RE.test(local)) return local;
    const cacheKey = local.toLowerCase().trim();
    const cached = readResolveCache(cacheKey);
    if (cached !== undefined) return cached || local;
    try {
        const res = await axios.get('/api/vault/resolve-by-title', { params: { title: local } });
        const id = res?.data?.id;
        writeResolveCache(cacheKey, id || null);
        return id || local;
    } catch {
        writeResolveCache(cacheKey, null);
        return local;
    }
}

/**
 * Renderitzador d'un wikilink inline amb:
 *  - Click → open in current tab (reemplaça)
 *  - Cmd/Ctrl+Click → open in new tab
 *  - Shift+Click → open in parallel pane
 *  - Hover → preview popup amb extracte (estil Wikipedia)
 *  - Right-click → menú contextual amb les 3 opcions
 *
 *  Fallback: si no es passa onOpenInCurrentTab/onOpenInNewTab, reutilitza
 *  onOpenParallel per mantenir compatibilitat amb instàncies antigues
 *  (PageViewModal, etc.) que només passen onOpenParallel.
 */
export const WikilinkInline = ({ title, target, idToTitle: idToTitleProp, onOpenInCurrentTab: onOpenInCurrentTabProp, onOpenInNewTab: onOpenInNewTabProp, onOpenParallel: onOpenParallelProp }) => {
    // CRITIC: el schema de BlockNote es congela quan es crea l'editor (no es
    // refà cada vegada que canvia globalIndex). Si llegim `idToTitle` de
    // contextValue per closure dins el spec, queda stale (size 0). Per això
    // llegim del context en VIVA (useContext) i només caiem als props si el
    // context no està disponible (p.ex. tests aïllats).
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

    // Resolució síncrona local (per al hover preview, que no pot ser async).
    const resolvedId = resolveTargetLocal(target, idToTitle);

    const callOpen = useCallback(async (mode) => {
        if (!target) return;
        // Per a clicks/menú: si la resolució local ha tornat un títol
        // (idToTitle no el coneix) fem un fallback ràpid al backend abans
        // de cridar el handler. Així el wikilink no és "mort" quan globalIndex
        // està buit o stale (per exemple just després d'un move).
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
        // Fallbacks: si l'embebedor no proporciona el handler específic,
        // degradem cap als disponibles per no fer un click "mort".
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
        if (menuPos) return; // menú obert: no mostrar hover
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

    // Quan el cursor entra dins el popup, manté obert.
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
        // Ignorar el botó dret: `onAuxClick` també dispara amb el clic dret
        // i, sense filtre, navegaria a "sameTab" tancant el menú contextual.
        // 0 = esquerre, 1 = mig, 2 = dret.
        if (typeof e.button === 'number' && e.button === 2) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
        }
        // Tanca hover/menú abans de navegar
        cancelTimers();
        setHoverActive(false);
        setAnchorRect(null);
        setMenuPos(null);
        if (!target) return;
        // Click amb botó del mig → nova tab (com els navegadors).
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
