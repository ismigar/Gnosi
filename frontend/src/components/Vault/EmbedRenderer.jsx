import React, { useState, useMemo, useCallback } from 'react';
import { Frame, ExternalLink, X, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const normalizeUrl = (value) => {
    if (typeof value !== 'string') return '';
    const v = value.trim();
    if (!v) return '';
    if (v.startsWith('Assets/')) return `/api/vault/assets/${v.substring(7)}`;
    if (v.startsWith('/api/vault/assets/')) return v;
    const absAssetMatch = v.match(/^https?:\/\/[^/]+\/api\/vault\/assets\/(.+)$/i);
    if (absAssetMatch?.[1]) return `/api/vault/assets/${absAssetMatch[1]}`;
    return v;
};

const detectKind = (url) => {
    if (!url) return 'empty';
    const lower = url.toLowerCase().split('?')[0].split('#')[0];
    if (lower.endsWith('.pdf')) return 'pdf';
    if (/\.(mp4|webm|ogv|mov|m4v)$/i.test(lower)) return 'video';
    if (/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(lower)) return 'audio';
    if (/\.(jpg|jpeg|png|gif|webp|avif|svg)$/i.test(lower)) return 'image';

    try {
        const u = new URL(url, window.location.origin);
        const host = u.hostname.replace(/^www\./, '');
        if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') return 'youtube';
        if (host === 'vimeo.com' || host === 'player.vimeo.com') return 'vimeo';
    } catch {
        // URL relativa o malformada — fallback iframe
    }

    return 'iframe';
};

const toYouTubeEmbed = (url) => {
    try {
        const u = new URL(url, window.location.origin);
        const host = u.hostname.replace(/^www\./, '');
        let videoId = '';
        if (host === 'youtu.be') {
            videoId = u.pathname.slice(1);
        } else if (u.pathname === '/watch') {
            videoId = u.searchParams.get('v') || '';
        } else if (u.pathname.startsWith('/embed/')) {
            return url;
        } else if (u.pathname.startsWith('/shorts/')) {
            videoId = u.pathname.replace('/shorts/', '').split('/')[0];
        }
        if (!videoId) return url;
        return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
    } catch {
        return url;
    }
};

const toVimeoEmbed = (url) => {
    try {
        const u = new URL(url, window.location.origin);
        if (u.hostname.includes('player.vimeo.com')) return url;
        const id = u.pathname.split('/').filter(Boolean).pop();
        if (!id) return url;
        return `https://player.vimeo.com/video/${encodeURIComponent(id)}`;
    } catch {
        return url;
    }
};

export const EmbedRenderer = React.forwardRef(({ block, editor }, ref) => {
    const { t } = useTranslation();
    const rawUrl = String(block?.props?.url || '').trim();
    const caption = String(block?.props?.caption || '').trim();
    const url = useMemo(() => normalizeUrl(rawUrl), [rawUrl]);
    const kind = useMemo(() => detectKind(url), [url]);
    const [editing, setEditing] = useState(!rawUrl);
    const [draft, setDraft] = useState(rawUrl);

    const commit = useCallback(() => {
        const value = draft.trim();
        if (!editor || !block?.id) return;
        try {
            editor.updateBlock(block.id, { props: { url: value, caption } });
            setEditing(false);
        } catch (e) {
            console.warn('EmbedRenderer commit failed:', e?.message);
        }
    }, [draft, caption, editor, block?.id]);

    const cancel = useCallback(() => {
        setDraft(rawUrl);
        setEditing(false);
    }, [rawUrl]);

    if (editing) {
        return (
            <div
                ref={ref}
                className="my-4 p-4 rounded-xl border border-dashed border-[var(--border-primary)] bg-[var(--bg-secondary)]/40"
            >
                <div className="flex items-center gap-2 text-[var(--gnosi-primary)] text-xs font-semibold uppercase tracking-wider mb-3">
                    <Frame size={13} />
                    {t('editor.embed_title', { defaultValue: 'Frame incrustat' })}
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); commit(); }
                            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
                        }}
                        placeholder={t('editor.embed_url_placeholder', { defaultValue: 'URL del PDF, vídeo o pàgina web…' })}
                        className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/40"
                    />
                    <button
                        onClick={commit}
                        className="p-2 rounded-lg bg-[var(--gnosi-primary)] text-white hover:opacity-90"
                        title={t('common.confirm', { defaultValue: 'Confirma' })}
                    >
                        <Check size={16} />
                    </button>
                    {rawUrl && (
                        <button
                            onClick={cancel}
                            className="p-2 rounded-lg border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]"
                            title={t('common.cancel', { defaultValue: 'Cancel·la' })}
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
            </div>
        );
    }

    let media = null;
    if (kind === 'pdf' || kind === 'iframe') {
        media = (
            <iframe
                src={url}
                title={caption || url}
                className="w-full h-[600px] rounded-lg border border-[var(--border-primary)] bg-white"
                loading="lazy"
            />
        );
    } else if (kind === 'youtube') {
        media = (
            <iframe
                src={toYouTubeEmbed(url)}
                title={caption || url}
                className="w-full aspect-video rounded-lg border border-[var(--border-primary)] bg-black"
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
            />
        );
    } else if (kind === 'vimeo') {
        media = (
            <iframe
                src={toVimeoEmbed(url)}
                title={caption || url}
                className="w-full aspect-video rounded-lg border border-[var(--border-primary)] bg-black"
                loading="lazy"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
            />
        );
    } else if (kind === 'video') {
        media = (
            <video src={url} controls className="w-full rounded-lg border border-[var(--border-primary)] bg-black" />
        );
    } else if (kind === 'audio') {
        media = (
            <audio src={url} controls className="w-full" />
        );
    } else if (kind === 'image') {
        media = (
            <img src={url} alt={caption || ''} className="max-w-full rounded-lg border border-[var(--border-primary)]" />
        );
    }

    return (
        <div ref={ref} className="my-4 group/embed">
            <div className="relative">
                {media}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/embed:opacity-100 transition-opacity">
                    <button
                        onClick={() => setEditing(true)}
                        className="px-2 py-1 text-xs rounded-md bg-[var(--bg-primary)]/90 border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]"
                        title={t('editor.embed_edit_url', { defaultValue: "Edita l'URL" })}
                    >
                        {t('common.edit', { defaultValue: 'Edita' })}
                    </button>
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-1 text-xs rounded-md bg-[var(--bg-primary)]/90 border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)] flex items-center gap-1"
                        title={t('editor.open_in_new_tab', { defaultValue: 'Obre en una nova pestanya' })}
                    >
                        <ExternalLink size={12} />
                    </a>
                </div>
            </div>
            {caption && (
                <div className="mt-1 text-xs text-[var(--text-tertiary)] text-center italic">{caption}</div>
            )}
        </div>
    );
});
EmbedRenderer.displayName = 'EmbedRenderer';
