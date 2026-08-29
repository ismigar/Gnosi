import { vaultPath } from '../../lib/vaultRouting';
import { stripManagedBlockMarkers } from './managedMarkdownUtils';

type GalleryMarkdownValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

interface GalleryNoteMetadata {
  description?: GalleryMarkdownValue;
  summary?: GalleryMarkdownValue;
}

interface GalleryNote {
  body_md?: GalleryMarkdownValue;
  content?: GalleryMarkdownValue;
  excerpt?: GalleryMarkdownValue;
  metadata?: GalleryNoteMetadata | null;
}

export function getGalleryMarkdown(
  note?: GalleryNote | null,
): string {
  const markdown =
    note?.body_md ||
    note?.content ||
    note?.excerpt ||
    note?.metadata?.description ||
    note?.metadata?.summary ||
    '';
  const visibleMarkdown: unknown = stripManagedBlockMarkers(String(markdown));
  return typeof visibleMarkdown === 'string' ? visibleMarkdown : '';
}

export function openGalleryPageWindow(
  pageId?: string | null,
): void {
  if (!pageId || typeof window === 'undefined') return;
  window.open(getGalleryPageUrl(pageId), '_blank', 'noopener,noreferrer');
}

export function getGalleryPageUrl(
  pageId?: string | null,
): string {
  const path = vaultPath(
    'knowledge',
    `page/${encodeURIComponent(pageId || '')}`,
  );
  if (typeof window === 'undefined') return path;
  return new URL(path, window.location.origin).toString();
}
