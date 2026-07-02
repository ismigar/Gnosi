import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
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
 * Resol un citation key. Retorna `{ id, page, cslItem }` o null si no hi és.
 * Per al render formatat, GET la pàgina sencera al backend (no només l'id)
 * perquè podem extraure el CSL-JSON localment.
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
        // Necessitem la metadata completa per al render CSL. Una sola crida
        // més (la pàgina). Cacheig de 5 min al mateix mapa per ser eficient.
        try {
            const page = await axios.get(`/api/vault/pages/${id}`);
            const cslItem = recursosPageToCsl(page.data);
            const value = { id, page: page.data, cslItem };
            writeCache(key, value);
            return value;
        } catch {
            // Si el GET falla, retornem només l'id perquè el click i el
            // hover encara funcionin (no render formatat).
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
 * Render d'una cita `[@key]` al BlockEditor. Mateix patró que WikilinkInline:
 *  - Click → obre la pàgina del Recursos corresponent al citation key
 *  - Hover → preview reutilitzant `WikilinkHoverPreview` un cop resolt el id
 *  - Cmd+Click → nova pestanya; Shift+Click → split-view
 *
 * Estil: chip distintiu (color secundari, prefix `@`) per diferenciar
 * dels wikilinks (que són blau primari).
 *
 * Quan la cita no resol (key inexistent al Vault), surt vermell amb
 * un tooltip indicant el problema — l'usuari sap que ha de revisar.
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
    const [formatted, setFormatted] = useState(null);  // string HTML quan disponible
    const [hoverActive, setHoverActive] = useState(false);
    const [anchorRect, setAnchorRect] = useState(null);

    // Estil i locale de cita venen del context (definit per la pàgina via
    // frontmatter, o el default global). Sense estil, mode "raw" (mostra @key).
    const cslStyle = ctx.cslStyle || 'apa';
    const cslLocale = ctx.cslLocale || 'ca-AD';

    useEffect(() => {
        let cancelled = false;
        setResolved(undefined);
        setFormatted(null);
        if (!citationKey) return undefined;
        (async () => {
            const value = await resolveCitationKey(citationKey);
            if (cancelled) return;
            setResolved(value);
            // Render formatat si tenim CSL-JSON
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
    //   - loading (undefined): gris, indica que encara resol
    //   - resolt (object): teal + cursor pointer; mostra format CSL si disponible
    //   - no resolt (null): vermell amb tooltip
    const isLoading = resolved === undefined;
    const isMissing = resolved === null;
    const cls = [
        'cite-inline px-1 rounded-sm cursor-pointer transition-all',
        // El text formatat (Turkle, 2011) usa estil natural; el @key raw, font-mono.
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
    // altrament. Si l'usuari encara està editant, el formatat dóna context;
    // si vol veure/editar el key cru, el tooltip li'l mostra.
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
                // contentEditable=false perquè el chip sigui atòmic dins
                // del BlockEditor (l'usuari l'esborra amb Backspace com a
                // unit, no entra dins per modificar el contingut).
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
