import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Frame, ExternalLink, Edit3, FolderOpen, AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VaultEditorContext } from './VaultEditorContext';

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

// Imatge incrustada amb reintents. Els assets d'OneDrive poden retornar 503
// fins que el backend els materialitza (online-only, errno 35). Sense reintent
// una imatge incrustada d'un asset evacuat quedava trencada fins recarregar la
// pàgina, a diferència del render de lectura (RetryableImage de VaultMarkdown),
// que ja reintenta. Mateix backoff exponencial (500ms · 2^intent, fins a 3).
function RetryableEmbedImage({ src, alt }) {
    const [attempt, setAttempt] = useState(0);
    return (
        <img
            key={attempt}
            src={src}
            alt={alt}
            className="max-w-full rounded-lg border border-[var(--border-primary)]"
            onError={() => {
                if (attempt < 3) {
                    const delay = 500 * Math.pow(2, attempt);
                    setTimeout(() => setAttempt((a) => a + 1), delay);
                }
            }}
        />
    );
}

export const EmbedRenderer = React.forwardRef(({ block, editor }, ref) => {
    const { t } = useTranslation();
    const context = React.useContext(VaultEditorContext);
    const requestInsertContent = context?.requestInsertContent;
    const rawUrl = String(block?.props?.url || '').trim();
    const caption = String(block?.props?.caption || '').trim();
    const url = useMemo(() => normalizeUrl(rawUrl), [rawUrl]);
    const kind = useMemo(() => detectKind(url), [url]);
    // Disponibilitat de la URL. Només la comprovem per a fitxers locals
    // servits via /api/vault/local-file/{token}, on l'usuari pot haver mogut
    // o esborrat el fitxer després d'incrustar-lo. Per a Vault assets o URLs
    // externes saltem la verificació (cost innecessari).
    const isLocalFileUrl = useMemo(() => /^\/api\/vault\/local-file\//.test(url), [url]);
    const [availability, setAvailability] = useState(isLocalFileUrl ? 'checking' : 'ok');

    useEffect(() => {
        if (!isLocalFileUrl || !url) {
            setAvailability('ok');
            return undefined;
        }
        let cancelled = false;
        setAvailability('checking');
        // HEAD per detectar 404 (token inexistent) o 410 (fitxer esborrat al
        // disc). El navegador no exposa el codi exacte a `fetch` no-cors per
        // a tots els casos, però `response.ok` és prou indicador.
        (async () => {
            try {
                const res = await fetch(url, { method: 'HEAD' });
                if (cancelled) return;
                setAvailability(res.ok ? 'ok' : 'missing');
            } catch {
                if (!cancelled) setAvailability('missing');
            }
        })();
        return () => { cancelled = true; };
    }, [isLocalFileUrl, url]);

    const openPicker = useCallback(async (initialTab = 'vault') => {
        if (!requestInsertContent || !editor || !block?.id) return;
        try {
            const result = await requestInsertContent({ initialTab });
            if (result?.url) {
                editor.updateBlock(block.id, { props: { url: result.url, caption } });
            }
        } catch (err) {
            if (!String(err?.message || '').match(/cancelled|superseded/)) {
                console.warn('embed picker error:', err?.message);
            }
        }
    }, [requestInsertContent, editor, block?.id, caption]);

    if (availability === 'missing') {
        return (
            <div
                ref={ref}
                className="my-4 p-6 rounded-xl border border-[var(--status-error)]/40 bg-[var(--status-error)]/5 flex flex-col items-center gap-3 text-center"
            >
                <div className="w-10 h-10 rounded-full bg-[var(--status-error)]/15 flex items-center justify-center">
                    <AlertTriangle size={18} className="text-[var(--status-error)]" />
                </div>
                <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                        {t('editor.embed_missing_title', { defaultValue: 'Fitxer no trobat' })}
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)] mt-1 max-w-md break-all">
                        {t('editor.embed_missing_subtitle', { defaultValue: "El fitxer local s'ha mogut o esborrat" })}: <span className="font-mono">{rawUrl}</span>
                    </div>
                </div>
                <button
                    onClick={() => openPicker('local')}
                    className="px-3 py-2 text-xs font-medium rounded-lg bg-[var(--gnosi-primary)] text-white hover:opacity-90 flex items-center gap-1.5"
                >
                    <RefreshCw size={14} />
                    {t('editor.embed_relink', { defaultValue: 'Re-vincula' })}
                </button>
            </div>
        );
    }

    if (!rawUrl) {
        return (
            <div
                ref={ref}
                className="my-4 p-8 rounded-xl border border-dashed border-[var(--border-primary)] bg-[var(--bg-secondary)]/30 flex flex-col items-center gap-4 text-center"
            >
                <div className="w-12 h-12 rounded-full bg-[var(--gnosi-primary)]/10 flex items-center justify-center">
                    <Frame size={22} className="text-[var(--gnosi-primary)]" />
                </div>
                <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                        {t('editor.embed_empty_title', { defaultValue: 'Frame incrustat' })}
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)] mt-1">
                        {t('editor.embed_empty_subtitle', { defaultValue: 'Tria un fitxer del Vault, navega pel disc, puja\'n un o enganxa una URL' })}
                    </div>
                </div>
                <div className="flex gap-2 flex-wrap justify-center">
                    <button
                        onClick={() => openPicker('vault')}
                        className="px-3 py-2 text-xs font-medium rounded-lg bg-[var(--gnosi-primary)] text-white hover:opacity-90 flex items-center gap-1.5"
                    >
                        <FolderOpen size={14} />
                        {t('editor.embed_pick_file', { defaultValue: 'Tria fitxer…' })}
                    </button>
                    <button
                        onClick={() => openPicker('url')}
                        className="px-3 py-2 text-xs font-medium rounded-lg border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)] flex items-center gap-1.5"
                    >
                        <ExternalLink size={14} />
                        {t('editor.embed_paste_url', { defaultValue: 'URL externa' })}
                    </button>
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
        media = <video src={url} controls className="w-full rounded-lg border border-[var(--border-primary)] bg-black" />;
    } else if (kind === 'audio') {
        media = <audio src={url} controls className="w-full" />;
    } else if (kind === 'image') {
        media = <RetryableEmbedImage src={url} alt={caption || ''} />;
    }

    return (
        <div ref={ref} className="my-4 group/embed">
            <div className="relative">
                {media}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/embed:opacity-100 transition-opacity">
                    <button
                        onClick={() => openPicker('vault')}
                        className="p-1.5 rounded-md bg-[var(--bg-primary)]/90 border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]"
                        title={t('editor.embed_change', { defaultValue: 'Canvia el fitxer' })}
                    >
                        <Edit3 size={12} />
                    </button>
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-md bg-[var(--bg-primary)]/90 border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)] flex items-center"
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
