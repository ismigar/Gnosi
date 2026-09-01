import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, Loader2, ExternalLink } from 'lucide-react';
import { fetchLinkPreview, type LinkPreview } from '../../../shared/api/links';

/**
 * LinkCardBlock
 * Preview card for a link (Notion-style "bookmark"): shows
 * title, description, image, and source site obtained via `/api/vault/link-preview`
 * (Open Graph). Saved to Markdown as `[bookmark: URL](URL)`.
 */

// In-memory cache of previews by URL (avoids refetch on re-render).
const previewCache = new Map<string, LinkPreview>();

interface LinkCardBlockValue {
    readonly props?: { readonly url?: string | null };
}

export interface LinkCardBlockProps {
    readonly block?: LinkCardBlockValue | null;
}

export default function LinkCardBlock({ block }: LinkCardBlockProps) {
    const { t } = useTranslation();
    const url = (block?.props?.url || '').trim();
    const [previewState, setPreviewState] = useState(() => ({
        url,
        translate: t,
        data: previewCache.get(url) || null,
        loading: Boolean(url) && !previewCache.has(url),
        error: '',
    }));
    // Reconcile changed inputs before committing, without remounting the card.
    // Retain the previous preview/error while loading, as the legacy card did.
    if (previewState.url !== url || previewState.translate !== t) {
        setPreviewState({
            ...previewState,
            url,
            translate: t,
            data: previewCache.get(url) || previewState.data,
            loading: Boolean(url) && !previewCache.has(url),
        });
    }
    const { data, loading, error } = previewState;

    useEffect(() => {
        if (!url || previewCache.has(url)) return undefined;
        let cancelled = false;
        const controller = new AbortController();
        void fetchLinkPreview(url, controller.signal)
            .then((preview) => {
                if (cancelled) return;
                previewCache.set(url, preview);
                setPreviewState(current => current.url === url && current.translate === t
                    ? { ...current, data: preview } : current);
            })
            .catch(() => {
                if (!cancelled && !controller.signal.aborted) {
                    setPreviewState(current => current.url === url && current.translate === t
                        ? { ...current, error: t('link_card.preview_error', "Couldn't load the preview.") }
                        : current);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setPreviewState(current => current.url === url && current.translate === t
                        ? { ...current, loading: false } : current);
                }
            });
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [t, url]);

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
