import React, { useCallback, useContext, useEffect, useState } from 'react';
import { BookText, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VaultEditorContext } from './VaultEditorContext';
import { recursosPageToCsl, renderBibliography } from './cslEngine';
import { resolveCitationKey } from '../../shared/api/citations';
import { fetchVaultPage } from '../../shared/api/vaults';

// Session-wide cache: citationKey → page CSL-JSON. Shared with
// CiteInline (the two components look at the same data).
const CSL_ITEM_CACHE = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchCslItem(citationKey) {
    const entry = CSL_ITEM_CACHE.get(citationKey);
    if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.value;
    try {
        const resolved = await resolveCitationKey(citationKey);
        const id = resolved?.id;
        if (!id) {
            CSL_ITEM_CACHE.set(citationKey, { ts: Date.now(), value: null });
            return null;
        }
        const page = await fetchVaultPage(id);
        const item = recursosPageToCsl(page);
        CSL_ITEM_CACHE.set(citationKey, { ts: Date.now(), value: item });
        return item;
    } catch {
        CSL_ITEM_CACHE.set(citationKey, { ts: Date.now(), value: null });
        return null;
    }
}

/**
 * Extracts all citation keys that appear as inline content `cite`
 * within the current document. Recursive over blocks and children. Preserves
 * the order of appearance (some styles, like IEEE numeric, depend on this
 * order to number [1], [2]…).
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
                    // Citations can also live inside [text](url)
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
 * Block that generates the bibliography of the current document. Auto-updates
 * when the document's citations change (via subscription to `editor.onChange`).
 *
 * Props (from propSchema):
 *  - style: CSL id ('apa', 'chicago-author-date', 'mla', 'ieee')
 *  - locale: locale code ('ca-AD', 'es-ES', 'en-US', 'en-GB')
 */
export function BibliographyBlock({ block, editor }) {
    const { t } = useTranslation();
    const ctx = useContext(VaultEditorContext) || {};
    const style = block?.props?.style || ctx.cslStyle || 'apa';
    const locale = block?.props?.locale || ctx.cslLocale || 'en-US';

    // `version` is a trigger for manual refresh (button). When it changes, force
    // re-collect + re-render.
    const [version, setVersion] = useState(0);
    const [citationKeys, setCitationKeys] = useState([]);
    const [html, setHtml] = useState(null);
    const [missing, setMissing] = useState([]);
    const [loading, setLoading] = useState(true);

    // Subscribes to document changes to detect when a citation is added/removed.
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
        // BlockNote uses `editor.onChange` (callback). The callback returns a
        // unsubscribe based on the version.
        let unsub;
        try {
            unsub = editor.onChange ? editor.onChange(recollect) : undefined;
        } catch { /* ignore */ }
        return () => {
            try {
                if (unsub) unsub();
            } catch {
                // The editor may already have disposed the subscription.
            }
        };
    }, [editor, version]);

    // Resolve + render. Triggered when keys, style, or locale change.
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
            // Resolves in parallel (cache avoids refetching the same key)
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
                    {t('citations.bibliography', { defaultValue: "Bibliography" })}
                    <span className="ml-2 text-[var(--text-tertiary)] text-xs font-normal">
                        ({style.toUpperCase()} · {citationKeys.length} {t('citations.refs', { defaultValue: "citations" })})
                    </span>
                </span>
                <button
                    onClick={refresh}
                    title={t('citations.refresh', { defaultValue: "Refresh" })}
                    className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                    contentEditable={false}
                >
                    <RefreshCw size={13} />
                </button>
            </div>
            {loading && (
                <div className="text-xs text-[var(--text-tertiary)] italic">
                    {t('citations.loading', { defaultValue: "Loading references…" })}
                </div>
            )}
            {!loading && !citationKeys.length && (
                <div className="text-xs text-[var(--text-tertiary)] italic">
                    {t('citations.empty', { defaultValue: "This document doesn't have any citations yet." })}
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
                    {t('citations.missing', { defaultValue: "Unresolved citations" })}:
                    {' '}{missing.map(k => `@${k}`).join(', ')}
                </div>
            )}
        </div>
    );
}

export default BibliographyBlock;
