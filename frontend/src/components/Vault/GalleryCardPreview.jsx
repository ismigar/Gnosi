import React, { useEffect, useRef, useState } from 'react';
import axios from '../../shared/api/legacy-http';
import { ExternalLink, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getGalleryMarkdown, getGalleryPageUrl, openGalleryPageWindow } from './galleryCardPreviewUtils';
import { VaultMarkdown } from './VaultMarkdown';

export function GalleryOpenButton({ pageId }) {
    const { t } = useTranslation();
    const label = t('editor.open_in_new_tab', { defaultValue: 'Open in a new tab' });

    return (
        <a
            href={getGalleryPageUrl(pageId)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            title={label}
            onClick={(event) => event.stopPropagation()}
            className="absolute right-2 top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)]/90 text-[var(--text-tertiary)] opacity-80 shadow-sm backdrop-blur-sm transition hover:text-[var(--gnosi-primary)] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gnosi-primary)]"
        >
            <ExternalLink size={13} aria-hidden="true" />
        </a>
    );
}

export function GalleryContentPreview({ note, idToTitle = {}, onNoteSelect, onOpenParallel }) {
    const { t } = useTranslation();
    const previewRef = useRef(null);
    const fallbackMarkdown = getGalleryMarkdown(note);
    const [visiblePageId, setVisiblePageId] = useState(null);
    const [fullContent, setFullContent] = useState(null);
    const pageId = note?.id || null;
    const markdown = fullContent?.pageId === pageId
        ? fullContent.markdown
        : fallbackMarkdown;

    useEffect(() => {
        const element = previewRef.current;
        if (!pageId || !element) return undefined;
        if (typeof IntersectionObserver === 'undefined') {
            const timer = window.setTimeout(() => setVisiblePageId(pageId), 0);
            return () => window.clearTimeout(timer);
        }

        const observer = new IntersectionObserver((entries) => {
            if (entries.some(entry => entry.isIntersecting)) {
                setVisiblePageId(pageId);
                observer.disconnect();
            }
        }, { rootMargin: '160px' });
        observer.observe(element);
        return () => observer.disconnect();
    }, [pageId]);

    useEffect(() => {
        if (!pageId || visiblePageId !== pageId || fullContent?.pageId === pageId) return undefined;
        const controller = new AbortController();
        axios.get(`/api/vault/pages/${encodeURIComponent(pageId)}/preview?full=true`, {
            signal: controller.signal,
        }).then((response) => {
            const fullMarkdown = response.data?.body_md || response.data?.content || '';
            if (fullMarkdown) {
                setFullContent({ pageId, markdown: getGalleryMarkdown({ body_md: fullMarkdown }) });
            }
        }).catch((error) => {
            if (error?.code !== 'ERR_CANCELED' && error?.name !== 'CanceledError') {
                // The summary remains usable when the lazy full-content request fails.
            }
        });
        return () => controller.abort();
    }, [fullContent?.pageId, pageId, visiblePageId]);

    return (
        <div
            ref={previewRef}
            tabIndex={0}
            aria-label={t('common.gallery_content_preview', { defaultValue: 'Page content preview' })}
            data-gallery-content-source={fullContent?.pageId === pageId ? 'full' : 'summary'}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
                if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
                    event.stopPropagation();
                }
            }}
            className="gallery-card-preview h-full overflow-y-auto overflow-x-hidden overscroll-contain rounded-md px-1 text-xs leading-relaxed text-[var(--text-secondary)] outline-none custom-scrollbar focus-visible:ring-1 focus-visible:ring-[var(--gnosi-primary)] feed-md break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-xs [&_img]:max-h-40 [&_img]:object-contain [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:[overflow-wrap:anywhere] [&_code]:whitespace-pre-wrap [&_code]:break-words [&_code]:[overflow-wrap:anywhere] [&_code]:overflow-x-hidden [&_table]:table [&_table]:w-full [&_table]:table-fixed [&_th]:break-words [&_td]:break-words"
        >
            {markdown ? (
                <VaultMarkdown
                    md={String(markdown)}
                    imageTitle={note?.title || ''}
                    idToTitle={idToTitle}
                    onActivate={() => onNoteSelect?.(note?.id)}
                    onOpenInCurrentTab={onOpenParallel || onNoteSelect}
                    onOpenInNewTab={openGalleryPageWindow}
                    onOpenParallel={onOpenParallel}
                />
            ) : (
                <div className="flex h-full items-center justify-center text-[var(--text-tertiary)] opacity-40">
                    <FileText size={24} strokeWidth={1.5} aria-hidden="true" />
                </div>
            )}
        </div>
    );
}
