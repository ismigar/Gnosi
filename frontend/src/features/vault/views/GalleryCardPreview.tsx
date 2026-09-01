import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { fetchVaultPagePreview, type VaultPagePreview } from '../../../shared/api/vaults';
import { getGalleryMarkdown, getGalleryPageUrl, openGalleryPageWindow, type GalleryPreviewNote } from './galleryCardPreviewUtils';
import { VaultMarkdown } from '../../../shared/editor/VaultMarkdown';

interface GalleryOpenButtonProps {
    readonly pageId?: string | null;
}

interface GalleryContentPreviewProps {
    readonly idToTitle?: Record<string, string>;
    readonly note?: GalleryPreviewNote | null;
    readonly onNoteSelect?: (pageId?: string | null) => void;
    readonly onOpenParallel?: (pageId: string) => void;
}

interface LoadedGalleryContent {
    readonly markdown: string;
    readonly pageId: string;
}

function getFullPreviewMarkdown(preview: VaultPagePreview): string {
    if (preview.body_md) return preview.body_md;
    if ('content' in preview && typeof preview.content === 'string') {
        return preview.content;
    }
    return '';
}

function isCanceledRequest(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const code = 'code' in error ? error.code : undefined;
    const name = 'name' in error ? error.name : undefined;
    return code === 'ERR_CANCELED' || name === 'CanceledError';
}

export function GalleryOpenButton({ pageId }: GalleryOpenButtonProps) {
    const { t } = useTranslation();
    const label = t('editor.open_in_new_tab', { defaultValue: 'Open in a new tab' });

    return (
        <a
            href={getGalleryPageUrl(pageId)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            title={label}
            onClick={(event) => {
                event.stopPropagation();
            }}
            className="absolute right-2 top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)]/90 text-[var(--text-tertiary)] opacity-80 shadow-sm backdrop-blur-sm transition hover:text-[var(--gnosi-primary)] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gnosi-primary)]"
        >
            <ExternalLink size={13} aria-hidden="true" />
        </a>
    );
}

export function GalleryContentPreview({
    note,
    idToTitle = {},
    onNoteSelect,
    onOpenParallel,
}: GalleryContentPreviewProps) {
    const { t } = useTranslation();
    const previewRef = useRef<HTMLDivElement>(null);
    const fallbackMarkdown = getGalleryMarkdown(note);
    const [visiblePageId, setVisiblePageId] = useState<string | null>(null);
    const [fullContent, setFullContent] = useState<LoadedGalleryContent | null>(null);
    const pageId = note?.id || null;
    const markdown = fullContent?.pageId === pageId
        ? fullContent.markdown
        : fallbackMarkdown;

    useEffect(() => {
        const element = previewRef.current;
        if (!pageId || !element) return undefined;
        if (typeof IntersectionObserver === 'undefined') {
            const timer = window.setTimeout(() => {
                setVisiblePageId(pageId);
            }, 0);
            return () => {
                window.clearTimeout(timer);
            };
        }

        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setVisiblePageId(pageId);
                observer.disconnect();
            }
        }, { rootMargin: '160px' });
        observer.observe(element);
        return () => {
            observer.disconnect();
        };
    }, [pageId]);

    useEffect(() => {
        if (!pageId || visiblePageId !== pageId || fullContent?.pageId === pageId) return undefined;
        const controller = new AbortController();
        void fetchVaultPagePreview(pageId, { full: true }, controller.signal).then((preview) => {
            const fullMarkdown = getFullPreviewMarkdown(preview);
            if (fullMarkdown) {
                setFullContent({ pageId, markdown: getGalleryMarkdown({ body_md: fullMarkdown }) });
            }
        }).catch((error: unknown) => {
            if (!isCanceledRequest(error)) {
                // The summary remains usable when the lazy full-content request fails.
            }
        });
        return () => {
            controller.abort();
        };
    }, [fullContent?.pageId, pageId, visiblePageId]);

    return (
        <div
            ref={previewRef}
            tabIndex={0}
            aria-label={t('common.gallery_content_preview', { defaultValue: 'Page content preview' })}
            data-gallery-content-source={fullContent?.pageId === pageId ? 'full' : 'summary'}
            onClick={(event) => {
                event.stopPropagation();
            }}
            onKeyDown={(event) => {
                if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
                    event.stopPropagation();
                }
            }}
            className="gallery-card-preview h-full overflow-y-auto overflow-x-hidden overscroll-contain rounded-md px-1 text-xs leading-relaxed text-[var(--text-secondary)] outline-none custom-scrollbar focus-visible:ring-1 focus-visible:ring-[var(--gnosi-primary)] feed-md break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-xs [&_img]:max-h-40 [&_img]:object-contain [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:[overflow-wrap:anywhere] [&_code]:whitespace-pre-wrap [&_code]:break-words [&_code]:[overflow-wrap:anywhere] [&_code]:overflow-x-hidden [&_table]:table [&_table]:w-full [&_table]:table-fixed [&_th]:break-words [&_td]:break-words"
        >
            {markdown ? (
                <VaultMarkdown
                    md={markdown}
                    imageTitle={note?.title ? String(note.title) : ''}
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
