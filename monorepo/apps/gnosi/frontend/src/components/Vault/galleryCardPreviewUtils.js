import { stripManagedBlockMarkers } from './managedMarkdownUtils';

export function getGalleryMarkdown(note) {
    const markdown = note?.body_md || note?.content || note?.excerpt
        || note?.metadata?.description || note?.metadata?.summary || '';
    return stripManagedBlockMarkers(String(markdown));
}

export function openGalleryPageWindow(pageId) {
    if (!pageId || typeof window === 'undefined') return;
    window.open(getGalleryPageUrl(pageId), '_blank', 'noopener,noreferrer');
}

export function getGalleryPageUrl(pageId) {
    const path = `/vault/page/${encodeURIComponent(pageId || '')}`;
    if (typeof window === 'undefined') return path;
    return new URL(path, window.location.origin).toString();
}
