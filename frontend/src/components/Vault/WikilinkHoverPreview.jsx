import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Cache de preview compartit entre instàncies. Evita refetch quan l'usuari
// passa el ratolí repetidament pels mateixos wikilinks (timeline, backlinks).
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
 * Invalida el preview cachejat d'una pàgina (o tot el cache si no passes id).
 * Cal cridar-la quan la pàgina ha canviat per evitar mostrar "Pàgina buida"
 * o un extracte obsolet a hovers posteriors fins que expiri el TTL de 5 min.
 */
// eslint-disable-next-line react-refresh/only-export-components -- helper exposat al costat del component perquè comparteixen el mateix cache local
export function invalidatePreviewCache(pageId) {
    if (!pageId) {
        PREVIEW_CACHE.clear();
        return;
    }
    PREVIEW_CACHE.delete(pageId);
}

// Invalidació via DOM event perquè qualsevol capa (interceptor d'axios,
// botons de "recarrega", cron de refresc) pugui demanar-ho sense haver
// d'importar aquest mòdul. detail.pageId opcional → si falta, neteja tot.
if (typeof window !== 'undefined') {
    window.addEventListener('gnosi:invalidatePreview', (ev) => {
        invalidatePreviewCache(ev?.detail?.pageId);
    });
}

/**
 * Popup estil Wikipedia per al hover de wikilinks.
 * Mostra títol, icon (si existeix) i extracte (primer paràgraf).
 *
 * Props:
 *  - pageId: ID resolt (UUID o títol normalitzat) de la pàgina
 *  - anchorRect: DOMRect del wikilink que ha disparat el hover
 *  - onMouseEnter / onMouseLeave: callbacks per mantenir el popup viu mentre
 *    el cursor és a sobre (delegada al component pare per al close timeout).
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

    // Posicionament: a sota del wikilink per defecte; si no hi cap, a sobre.
    // useLayoutEffect per evitar flash visible amb posició errònia.
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
                    style={{ backgroundImage: `url(${data.cover})` }}
                />
            )}
            <div className="p-4">
                {loading && (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                        <div className="w-3 h-3 border-2 border-slate-300 border-t-[var(--gnosi-primary)] rounded-full animate-spin" />
                        <span>{t('common.loading', 'Carregant…')}</span>
                    </div>
                )}
                {error && (
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                        <FileText size={14} />
                        <span>{t('wikilink.preview_error', 'No s\'ha pogut carregar la pàgina')}</span>
                    </div>
                )}
                {!loading && !error && data && (
                    <>
                        <div className="flex items-center gap-2 mb-2">
                            {data.icon ? (
                                <span className="text-base leading-none">{data.icon}</span>
                            ) : (
                                <FileText size={14} className="text-slate-400 flex-shrink-0" />
                            )}
                            <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
                                {data.title || t('common.untitled', 'Sense títol')}
                            </h4>
                        </div>
                        {data.excerpt ? (
                            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-6 whitespace-pre-line">
                                {data.excerpt}
                            </p>
                        ) : (
                            <p className="text-xs text-slate-400 italic">{t('wikilink.empty_page', 'Pàgina buida')}</p>
                        )}
                    </>
                )}
            </div>
        </div>
    );

    return typeof document !== 'undefined' ? createPortal(popup, document.body) : null;
};

export default WikilinkHoverPreview;
