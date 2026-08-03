import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { Link2, Loader2, ExternalLink } from 'lucide-react';

/**
 * LinkCardBlock
 * Preview card for a link (Notion-style "bookmark"): shows
 * title, description, image, and source site obtained via `/api/vault/link-preview`
 * (Open Graph). Saved to Markdown as `[bookmark: URL](URL)`.
 */

// In-memory cache of previews by URL (avoids refetch on re-render).
const _previewCache = new Map();

export default function LinkCardBlock({ block }) {
    const { t } = useTranslation();
    const url = String(block?.props?.url || '').trim();
    const [data, setData] = useState(() => _previewCache.get(url) || null);
    const [loading, setLoading] = useState(!_previewCache.has(url));
    const [error, setError] = useState('');

    useEffect(() => {
        if (!url) { setLoading(false); return undefined; }
        if (_previewCache.has(url)) { setData(_previewCache.get(url)); setLoading(false); return undefined; }
        let cancelled = false;
        setLoading(true);
        axios.get('/api/vault/link-preview', { params: { url } })
            .then((res) => {
                if (cancelled) return;
                _previewCache.set(url, res.data);
                setData(res.data);
            })
            .catch(() => { if (!cancelled) setError(t('link_card.preview_error', "Couldn't load the preview.")); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [url]);

    let host = url;
    try { host = new URL(url).host; } catch { /* noop */ }

    return (
        <div className="bn-linkcard my-3" contentEditable={false}>
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex overflow-hidden rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] no-underline transition-colors hover:border-[var(--gnosi-primary)]"
            >
                <div className="min-w-0 flex-1 p-3">
                    {loading ? (
                        <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
                            <Loader2 size={14} className="animate-spin" /> {t('link_card.loading', "Loading preview…")}
                        </div>
                    ) : (
                        <>
                            <div className="line-clamp-2 text-sm font-semibold text-[var(--text-primary)]">
                                {(data?.title) || error || host}
                            </div>
                            {data?.description && (
                                <div className="mt-1 line-clamp-2 text-xs text-[var(--text-secondary)]">{data.description}</div>
                            )}
                            <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
                                {data?.favicon
                                    ? <img src={data.favicon} alt="" width={14} height={14} className="rounded-sm" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                    : <Link2 size={12} />}
                                <span className="truncate">{(data?.site_name) || host}</span>
                                <ExternalLink size={11} className="opacity-60" />
                            </div>
                        </>
                    )}
                </div>
                {data?.image && (
                    <div
                        className="hidden w-40 shrink-0 bg-cover bg-center sm:block"
                        style={{ backgroundImage: `url("${data.image}")` }}
                        aria-hidden
                    />
                )}
            </a>
        </div>
    );
}
