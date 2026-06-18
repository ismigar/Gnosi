import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { BookText, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VaultEditorContext } from './VaultEditorContext';
import { recursosPageToCsl, renderBibliography } from './cslEngine';

// Cache per a tota la sessió: citationKey → page CSL-JSON. Compartit amb
// CiteInline (els two components miren la mateixa data).
const CSL_ITEM_CACHE = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchCslItem(citationKey) {
    const entry = CSL_ITEM_CACHE.get(citationKey);
    if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.value;
    try {
        const r = await axios.get('/api/vault/resolve-by-citation-key', { params: { key: citationKey } });
        const id = r?.data?.id;
        if (!id) {
            CSL_ITEM_CACHE.set(citationKey, { ts: Date.now(), value: null });
            return null;
        }
        const page = await axios.get(`/api/vault/pages/${id}`);
        const item = recursosPageToCsl(page.data);
        CSL_ITEM_CACHE.set(citationKey, { ts: Date.now(), value: item });
        return item;
    } catch {
        CSL_ITEM_CACHE.set(citationKey, { ts: Date.now(), value: null });
        return null;
    }
}

/**
 * Extreu tots els citation keys que apareixen com a inline content `cite`
 * dins del document actual. Recursiu sobre blocks i children. Manté
 * l'ordre d'aparició (alguns estils, com IEEE numeric, depenen d'aquest
 * ordre per numerar [1], [2]…).
 */
function collectCitationKeys(blocks, acc = [], seen = new Set()) {
    if (!Array.isArray(blocks)) return acc;
    for (const block of blocks) {
        const content = block?.content;
        if (Array.isArray(content)) {
            for (const item of content) {
                if (item?.type === 'cite' && item.props?.citationKey) {
                    const k = item.props.citationKey;
                    if (!seen.has(k)) { seen.add(k); acc.push(k); }
                } else if (item?.type === 'link' && Array.isArray(item.content)) {
                    // Cites poden viure dins de [text](url) també
                    for (const sub of item.content) {
                        if (sub?.type === 'cite' && sub.props?.citationKey) {
                            const k = sub.props.citationKey;
                            if (!seen.has(k)) { seen.add(k); acc.push(k); }
                        }
                    }
                }
            }
        }
        if (Array.isArray(block?.children)) {
            collectCitationKeys(block.children, acc, seen);
        }
    }
    return acc;
}

/**
 * Block que genera la bibliografia del document actual. S'auto-actualitza
 * quan canvien els cites del doc (via subscripció a `editor.onChange`).
 *
 * Props (del propSchema):
 *  - style: id CSL ('apa', 'chicago-author-date', 'mla', 'ieee')
 *  - locale: codi locale ('ca-AD', 'es-ES', 'en-US', 'en-GB')
 */
export function BibliographyBlock({ block, editor }) {
    const { t } = useTranslation();
    const ctx = useContext(VaultEditorContext) || {};
    const style = block?.props?.style || ctx.cslStyle || 'apa';
    const locale = block?.props?.locale || ctx.cslLocale || 'ca-AD';

    // `version` és un trigger per refresc manual (botó). Quan canvia, force
    // re-collect + re-render.
    const [version, setVersion] = useState(0);
    const [citationKeys, setCitationKeys] = useState([]);
    const [html, setHtml] = useState(null);
    const [missing, setMissing] = useState([]);
    const [loading, setLoading] = useState(true);

    // Subscriu a canvis del document per detectar quan s'afegeix/treu una cita.
    useEffect(() => {
        if (!editor) return undefined;
        const recollect = () => {
            try {
                const blocks = editor.document || editor.topLevelBlocks || [];
                const keys = collectCitationKeys(blocks);
                setCitationKeys(keys);
            } catch (err) {
                console.warn('bibliography collect failed', err);
            }
        };
        recollect();
        // BlockNote usa `editor.onChange` (callback). El callback retorna un
        // unsubscribe segons la versió.
        let unsub;
        try {
            unsub = editor.onChange ? editor.onChange(recollect) : undefined;
        } catch { /* ignore */ }
        return () => { try { unsub && unsub(); } catch {} };
    }, [editor, version]);

    // Resoldre + renderitzar. Es dispara quan canvien keys, style o locale.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        if (!citationKeys.length) {
            setHtml(null);
            setMissing([]);
            setLoading(false);
            return undefined;
        }
        (async () => {
            const items = {};
            const missingKeys = [];
            // Resol en paral·lel (cache evita refetch del mateix key)
            const results = await Promise.all(citationKeys.map(fetchCslItem));
            results.forEach((it, i) => {
                if (it) items[citationKeys[i]] = it;
                else missingKeys.push(citationKeys[i]);
            });
            if (cancelled) return;
            const knownKeys = citationKeys.filter(k => items[k]);
            try {
                const bib = await renderBibliography(knownKeys, items, style, locale);
                if (!cancelled) {
                    setHtml(bib?.entries?.join('') || null);
                    setMissing(missingKeys);
                    setLoading(false);
                }
            } catch (err) {
                console.warn('bibliography render failed', err);
                if (!cancelled) { setLoading(false); setHtml(null); }
            }
        })();
        return () => { cancelled = true; };
    }, [citationKeys, style, locale, version]);

    const refresh = useCallback(() => setVersion(v => v + 1), []);

    return (
        <div className="bibliography-block my-6 p-4 rounded-lg border border-[var(--border-primary)]/40 bg-[var(--bg-secondary)]/30">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-[var(--text-secondary)]">
                <BookText size={16} className="text-[var(--gnosi-primary)]" />
                <span className="flex-1">
                    {t('citations.bibliography', { defaultValue: 'Bibliografia' })}
                    <span className="ml-2 text-[var(--text-tertiary)] text-xs font-normal">
                        ({style.toUpperCase()} · {citationKeys.length} {t('citations.refs', { defaultValue: 'cites' })})
                    </span>
                </span>
                <button
                    onClick={refresh}
                    title={t('citations.refresh', { defaultValue: 'Refresca' })}
                    className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                    contentEditable={false}
                >
                    <RefreshCw size={13} />
                </button>
            </div>
            {loading && (
                <div className="text-xs text-[var(--text-tertiary)] italic">
                    {t('citations.loading', { defaultValue: 'Carregant referències…' })}
                </div>
            )}
            {!loading && !citationKeys.length && (
                <div className="text-xs text-[var(--text-tertiary)] italic">
                    {t('citations.empty', { defaultValue: 'Aquest document encara no té cap cita.' })}
                </div>
            )}
            {!loading && html && (
                <div
                    className="csl-bib text-[14px] leading-relaxed"
                    contentEditable={false}
                    style={{ pointerEvents: 'auto' }}
                    dangerouslySetInnerHTML={{ __html: html }}
                />
            )}
            {!loading && missing.length > 0 && (
                <div className="mt-3 text-xs text-red-500">
                    {t('citations.missing', { defaultValue: 'Cites no resoltes' })}:
                    {' '}{missing.map(k => `@${k}`).join(', ')}
                </div>
            )}
        </div>
    );
}

export default BibliographyBlock;
