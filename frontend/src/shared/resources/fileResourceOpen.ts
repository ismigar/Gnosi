import { fetchNotebookEvidence } from '../api/notebooks';
import { transportFetch } from '../api/transports';
import { getActiveVaultSlug } from '../api/vault-context';
import {
  emitCancelableAppEvent,
  type DocumentLocationEventDetail,
} from '../platform/app-events';
import { logError } from '../notifications/notifyError';
import { toast } from '../notifications/toast';
import {
  documentKindForHref,
  documentResourceKey,
  documentWindowName,
  fileKindFromValue,
  filenameFromTarget,
  fileResourceString,
} from './fileResourcePaths';

export type FileResourceNavigate = (path: string) => unknown;
export type FileResourceTranslate = (
  key: string,
  options?: Readonly<Record<string, unknown>>,
) => string;

export interface FileResourceLocation {
  readonly [key: string]: unknown;
  readonly highlightText?: unknown;
  readonly pageNumber?: unknown;
}

export interface OpenFileResourceOptions {
  readonly location?: FileResourceLocation | null;
  readonly navigate?: FileResourceNavigate;
  readonly t?: FileResourceTranslate;
  readonly title?: string;
}

export interface CitationDescriptor {
  readonly chunk?: unknown;
  readonly highlightText?: unknown;
  readonly kind?: unknown;
  readonly notebook?: unknown;
  readonly revision?: unknown;
  readonly segment?: unknown;
  readonly snapshot?: unknown;
  readonly start?: unknown;
}

export interface OpenCitationOptions {
  readonly citation?: CitationDescriptor;
  readonly navigate?: FileResourceNavigate;
  readonly t?: FileResourceTranslate;
}

const DOC_ATTACHMENT_KEYS = [
  'files', 'Files', 'Fitxers', 'Arxiu/s', 'Arxiu', 'Archivo/s', 'Archivo',
  'Adjunts', 'attachments', 'adjuntos', "Ruta de l'arxiu", 'ruta_arxiu',
  'file_path', 'path', 'URL', 'url',
] as const;

const defaultTranslate: FileResourceTranslate = (key, options) => {
  const defaultValue = options?.defaultValue;
  return typeof defaultValue === 'string' ? defaultValue : key;
};

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordProperty(value: unknown, key: string): unknown {
  return isUnknownRecord(value) ? value[key] : undefined;
}

function attachmentCandidates(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function cleanAttachment(value: unknown): string {
  const attachment = fileResourceString(value)
    .trim()
    .replace(/^\[\[/, '')
    .replace(/\]\]$/, '');
  return (attachment.split('|')[0] ?? '').trim();
}

async function copyPathToClipboard(
  target: string,
  translate: FileResourceTranslate,
): Promise<void> {
  let plain = target;
  if (/^file:\/\//i.test(target)) {
    try {
      plain = decodeURIComponent(target.slice(7));
    } catch {
      plain = target.slice(7);
    }
  }
  try {
    await navigator.clipboard.writeText(plain);
    toast.success(
      translate('editor.local_open_clipboard', {
        defaultValue: 'Path copied: {{path}}\nOpen Finder and press Cmd+Shift+G to paste it.',
        path: plain,
      }),
      { duration: 6000 },
    );
  } catch {
    toast.error(plain, { duration: 8000 });
  }
}

async function openViaSystem(
  target: string,
  translate: FileResourceTranslate,
): Promise<void> {
  try {
    const response = await transportFetch('/api/vault/open-local-path', {
      body: JSON.stringify({ path: target }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (response.ok) return;
    await copyPathToClipboard(target, translate);
  } catch (error) {
    logError('file-resource.open-local-path', error);
    await copyPathToClipboard(target, translate);
  }
}

export function openFileResource(
  target: unknown,
  options: OpenFileResourceOptions = {},
): void {
  if (!target) return;
  const src = fileResourceString(target).trim();
  const {
    location,
    navigate,
    t = defaultTranslate,
    title,
  } = options;
  const documentKind = documentKindForHref(src);
  if (documentKind) {
    const eventLocation: DocumentLocationEventDetail | null = location || null;
    const unhandled = emitCancelableAppEvent('gnosi:open-pdf', {
      documentKey: documentResourceKey(src),
      kind: documentKind,
      location: eventLocation,
      src,
      title: title || filenameFromTarget(src),
    });
    if (unhandled) {
      const query = new URLSearchParams({ kind: documentKind, src });
      if (eventLocation?.pageNumber) {
        query.set('page', fileResourceString(eventLocation.pageNumber));
      }
      const slug = getActiveVaultSlug();
      const documentUrl = slug
        ? `/@${encodeURIComponent(slug)}/knowledge/document?${query.toString()}`
        : `/vault/pdf?${query.toString()}`;
      if (navigate) {
        navigate(documentUrl);
      } else {
        const readerWindow = window.open(documentUrl, documentWindowName(src));
        if (readerWindow) {
          try {
            readerWindow.opener = null;
          } catch {
            // The browsing context can own this property.
          }
          readerWindow.focus();
        }
      }
    }
    return;
  }

  if (/^https?:\/\//i.test(src) || src.startsWith('/api/')) {
    window.open(src, '_blank', 'noopener');
    return;
  }
  const fileUrl = /^file:\/\//i.test(src) ? src : `file://${src}`;
  void openViaSystem(fileUrl, t);
}

export function findDocAttachment(
  metadata: Readonly<Record<string, unknown>> = {},
): string {
  for (const key of DOC_ATTACHMENT_KEYS) {
    for (const candidate of attachmentCandidates(metadata[key])) {
      const value = cleanAttachment(candidate);
      if (value && documentKindForHref(value)) return value;
    }
  }
  return '';
}

export function findCitationAttachment(
  metadata: Readonly<Record<string, unknown>> = {},
  kind: unknown = '',
): string {
  const wanted = fileResourceString(kind).toLowerCase();
  for (const key of DOC_ATTACHMENT_KEYS) {
    for (const candidate of attachmentCandidates(metadata[key])) {
      const value = cleanAttachment(candidate);
      const fileKind = fileKindFromValue(value);
      const documentOrUrl = fileKind === 'document' || fileKind === 'url';
      if (
        value
        && (
          ['pdf', 'epub', 'html', 'docx', 'txt', 'md', 'url', 'body'].includes(wanted)
          && documentOrUrl
          || wanted === 'audio' && fileKind === 'audio'
          || wanted === 'video' && fileKind === 'video'
          || wanted === 'stream' && fileKind === 'url'
          || wanted === 'image' && fileKind === 'image'
        )
      ) return value;
    }
  }
  return findDocAttachment(metadata);
}

function withMediaTimestamp(src: string, start: unknown): string {
  const seconds = Math.max(0, Math.floor(Number(start) || 0));
  if (!seconds || !/^https?:\/\//i.test(src)) return src;
  try {
    const url = new URL(src);
    if (/youtube\.com|youtu\.be/i.test(url.hostname)) {
      url.searchParams.set('t', `${String(seconds)}s`);
      return url.toString();
    }
  } catch {
    // Fall back to the standard media-fragment syntax.
  }
  return `${src.replace(/#.*$/, '')}#t=${String(seconds)}`;
}

function evidenceLocator(evidence: unknown): Readonly<Record<string, unknown>> {
  const segment = recordProperty(evidence, 'segment');
  const segmentLocator = recordProperty(segment, 'locator');
  const locator = segmentLocator ?? recordProperty(evidence, 'locator');
  return isUnknownRecord(locator) ? locator : {};
}

function evidenceText(evidence: unknown): unknown {
  return recordProperty(recordProperty(evidence, 'segment'), 'text')
    ?? recordProperty(evidence, 'text');
}

async function loadCitationEvidence(
  resourceId: string,
  citation: CitationDescriptor,
): Promise<unknown> {
  if (citation.notebook && citation.chunk) {
    try {
      const revision = fileResourceString(citation.revision).trim();
      return await fetchNotebookEvidence(
        fileResourceString(citation.notebook),
        fileResourceString(citation.chunk),
        /^\d+$/.test(revision) ? Number(revision) : undefined,
      );
    } catch {
      return null;
    }
  }
  if (citation.snapshot && citation.segment) {
    try {
      const response = await transportFetch(
        `/api/vault/llm-wiki/evidence/${encodeURIComponent(resourceId)}/${encodeURIComponent(fileResourceString(citation.snapshot))}/${encodeURIComponent(fileResourceString(citation.segment))}`,
        { credentials: 'include' },
      );
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function openCitation(
  resourceIdValue: unknown,
  page: unknown,
  options: OpenCitationOptions = {},
): Promise<unknown> {
  const resourceId = fileResourceString(resourceIdValue);
  const { citation = {}, navigate, t = defaultTranslate } = options;
  const evidence = await loadCitationEvidence(resourceId, citation);
  try {
    const response = await transportFetch(
      `/api/vault/pages/${encodeURIComponent(resourceId)}`,
      { credentials: 'include' },
    );
    if (response.ok) {
      const data: unknown = await response.json();
      const nestedMetadata = recordProperty(data, 'metadata');
      const metadata = isUnknownRecord(nestedMetadata)
        ? nestedMetadata
        : isUnknownRecord(data) ? data : {};
      const kind = recordProperty(evidence, 'kind')
        || recordProperty(evidence, 'source_kind')
        || citation.kind
        || '';
      const evidenceSource = recordProperty(evidence, 'source_url');
      let src = typeof evidenceSource === 'string'
        ? evidenceSource
        : findCitationAttachment(metadata, kind);
      if (src) {
        const locator = evidenceLocator(evidence);
        const evidencePage = locator.page;
        const pageNumber = evidencePage || page;
        const highlightText = fileResourceString(
          citation.highlightText || evidenceText(evidence) || '',
        ).trim();
        const location = pageNumber || highlightText
          ? {
              ...(highlightText ? { highlightText } : {}),
              ...(pageNumber ? { pageNumber: fileResourceString(pageNumber) } : {}),
            }
          : null;
        src = withMediaTimestamp(src, citation.start ?? locator.start);
        openFileResource(src, { location, navigate, t });
        return evidence;
      }
    }
  } catch {
    // Fall through to the user-facing fallback.
  }
  toast.error(t('pdf.cite_no_doc', {
    defaultValue: 'The resource has no document to open at the citation.',
  }));
  return evidence;
}
