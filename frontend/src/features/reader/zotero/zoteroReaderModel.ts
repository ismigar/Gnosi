import type { DocumentLocationEventDetail } from '../../../shared/platform/app-events';

export type ZoteroReaderKind = 'epub' | 'pdf' | 'snapshot';

export interface ZoteroReaderTabProps {
  readonly kind?: string | null;
  readonly location?: DocumentLocationEventDetail | null;
  readonly onClose?: () => unknown;
  readonly src?: string | null;
  readonly title?: string | null;
}

export interface ZoteroAnnotation extends Readonly<Record<string, unknown>> {
  readonly color?: unknown;
  readonly comment?: unknown;
  readonly id?: unknown;
  readonly position?: unknown;
  readonly tags?: unknown;
  readonly text?: unknown;
  readonly type?: unknown;
}

export interface AnnotationIdUpdate {
  readonly newId: string;
  readonly oldId: string;
}

export interface PersistedPdfAnnotation {
  readonly color: string;
  readonly comment: string;
  readonly page: number;
  readonly rects: readonly unknown[];
  readonly source_uri: string;
  readonly tags: string | null;
  readonly text: string | null;
  readonly type: string;
}

const ZOTERO_BLOB_PREFIX = '__ZOTERO_JSON__';
const KIND_BY_EXTENSION: Readonly<Record<string, ZoteroReaderKind>> = {
  epub: 'epub',
  htm: 'snapshot',
  html: 'snapshot',
  pdf: 'pdf',
};

export function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function annotationTags(value: unknown): string | null {
  if (!isUnknownArray(value) || value.length === 0) return null;
  const names = value.map((tag) => {
    if (typeof tag === 'string') return tag;
    if (!isUnknownRecord(tag)) return '';
    return typeof tag.name === 'string' ? tag.name : '';
  });
  return names.join(',');
}

export function toFilesystemPath(src: string): string {
  if (!src) return '';
  if (!/^file:\/\//i.test(src)) return src;
  try {
    return decodeURIComponent(src.slice(7));
  } catch {
    return src.slice(7);
  }
}

export function detectKindFromSrc(src?: string | null): ZoteroReaderKind {
  if (!src) return 'pdf';
  const withoutQuery = src.split('?')[0] ?? '';
  const clean = (withoutQuery.split('#')[0] ?? '').toLowerCase();
  const extension = clean.match(/\.([a-z0-9]+)$/)?.[1];
  return extension ? KIND_BY_EXTENSION[extension] ?? 'pdf' : 'pdf';
}

export function pdfAnnotationToZotero(value: unknown): ZoteroAnnotation {
  const annotation = isUnknownRecord(value) ? value : {};
  const comment = stringValue(annotation.comment);
  const id = annotation.id;
  if (comment.startsWith(ZOTERO_BLOB_PREFIX)) {
    try {
      const parsed: unknown = JSON.parse(comment.slice(ZOTERO_BLOB_PREFIX.length));
      return {
        ...(isUnknownRecord(parsed) ? parsed : {}),
        id: `gnosi:${typeof id === 'number' || typeof id === 'string' ? String(id) : ''}`,
      };
    } catch {
      // Fall through to the lossy legacy reconstruction.
    }
  }
  const page = numberValue(annotation.page, 1);
  const createdAt = stringValue(annotation.created_at, new Date().toISOString());
  return {
    authorName: '',
    color: stringValue(annotation.color, '#ffeb3b'),
    comment: '',
    dateCreated: createdAt,
    dateModified: stringValue(annotation.updated_at, createdAt),
    id: `gnosi:${typeof id === 'number' || typeof id === 'string' ? String(id) : ''}`,
    isAuthorNameAuthoritative: true,
    pageLabel: String(page),
    position: {
      pageIndex: Math.max(0, page - 1),
      rects: [],
    },
    sortIndex: '00000|0|0',
    tags: [],
    text: stringValue(annotation.text),
    type: stringValue(annotation.type, 'highlight'),
  };
}

export function zoteroToPdfAnnotation(
  annotation: ZoteroAnnotation,
  sourceUri: string,
): PersistedPdfAnnotation {
  const position = isUnknownRecord(annotation.position) ? annotation.position : {};
  const pageIndex = numberValue(position.pageIndex, 0);
  return {
    color: stringValue(annotation.color, '#ffeb3b'),
    comment: `${ZOTERO_BLOB_PREFIX}${JSON.stringify(annotation)}`,
    page: pageIndex + 1,
    rects: [],
    source_uri: sourceUri,
    tags: annotationTags(annotation.tags),
    text: typeof annotation.text === 'string' ? annotation.text : null,
    type: stringValue(annotation.type, 'highlight'),
  };
}
