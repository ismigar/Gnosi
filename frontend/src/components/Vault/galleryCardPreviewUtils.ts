import { vaultPath } from '../../lib/vaultRouting';
import { stripManagedBlockMarkers } from './managedMarkdownUtils';
import type { VaultViewPage } from '../../hooks/useVaultViewData';

export interface GalleryPreviewNote {
  readonly [key: string]: unknown;
  readonly body_md?: unknown;
  readonly content?: unknown;
  readonly excerpt?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
  readonly id?: string | null;
  readonly title?: VaultViewPage['title'];
}

export function getGalleryMarkdown(
  note?: GalleryPreviewNote | null,
): string {
  const markdown =
    note?.body_md ||
    note?.content ||
    note?.excerpt ||
    note?.metadata?.description ||
    note?.metadata?.summary ||
    '';
  const text: string = Reflect.apply(String, undefined, [markdown]);
  return stripManagedBlockMarkers(text);
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
