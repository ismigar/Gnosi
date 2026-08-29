import {
  ACTIVE_VAULT_ID_KEY,
  getActiveVaultId as readActiveVaultId,
  getActiveVaultSlug,
  setActiveVaultCookie as writeActiveVaultCookie,
} from '../shared/api/vault-context';

export type DocumentKind = 'epub' | 'pdf' | 'snapshot';
export type FileKind = 'audio' | 'document' | 'file' | 'image' | 'url' | 'video';

export interface FileEntry {
  readonly label: string;
  readonly target: string;
}

export interface ImageFieldValue {
  readonly alt: string;
  readonly caption: string;
  readonly credit: string;
  readonly src: string;
  readonly title: string;
}

export interface ImageFieldExtras {
  readonly alt?: unknown;
  readonly caption?: unknown;
  readonly credit?: unknown;
  readonly title?: unknown;
}

const DOCUMENT_KIND_BY_EXT: Readonly<Record<string, DocumentKind>> = {
  epub: 'epub',
  htm: 'snapshot',
  html: 'snapshot',
  pdf: 'pdf',
};
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v)(\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|flac|ogg|aac)(\?|#|$)/i;
const STORAGE_FOLDER_ALIASES: Readonly<Record<string, string>> = {
  biblioteca: 'library',
};

export const ACTIVE_VAULT_KEY = ACTIVE_VAULT_ID_KEY;

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function fileResourceString(value: unknown): string {
  if (!value) return '';
  try {
    return Reflect.apply(String, undefined, [value]);
  } catch {
    return '';
  }
}

export function documentKindForHref(href: unknown): DocumentKind | null {
  if (!href) return null;
  const withoutQuery = fileResourceString(href).split('?')[0] ?? '';
  const clean = (withoutQuery.split('#')[0] ?? '').toLowerCase();
  const match = clean.match(/\.([a-z0-9]+)$/);
  const extension = match?.[1];
  return extension ? DOCUMENT_KIND_BY_EXT[extension] ?? null : null;
}

export function fileKindFromValue(value: unknown): FileKind {
  const normalized = fileResourceString(value).trim().toLowerCase();
  if (!normalized) return 'file';
  if (normalized.startsWith('data:image/') || IMAGE_EXT.test(normalized)) return 'image';
  if (documentKindForHref(normalized)) return 'document';
  if (VIDEO_EXT.test(normalized)) return 'video';
  if (AUDIO_EXT.test(normalized)) return 'audio';
  if (/^https?:\/\//i.test(normalized)) return 'url';
  return 'file';
}

export function getActiveVaultId(): string | null {
  return readActiveVaultId() || null;
}

export function setActiveVaultCookie(id: string | null): void {
  writeActiveVaultCookie(id);
}

export function syncActiveVaultCookie(): void {
  setActiveVaultCookie(getActiveVaultId());
}

export function withActiveVault(url: string, explicitVid?: string | null): string;
export function withActiveVault<T>(url: T, explicitVid?: string | null): T;
export function withActiveVault<T>(url: T, explicitVid?: string | null): T | string {
  if (typeof url !== 'string' || !url.startsWith('/api/vault/')) return url;
  if (!explicitVid) {
    const slug = getActiveVaultSlug();
    if (slug) {
      return `/api/v1/vaults/${encodeURIComponent(slug)}/knowledge/${url.slice('/api/vault/'.length)}`;
    }
  }
  if (/[?&]vault=/.test(url)) return url;
  const vaultId = explicitVid || getActiveVaultId();
  if (!vaultId) return url;
  return `${url}${url.includes('?') ? '&' : '?'}vault=${encodeURIComponent(vaultId)}`;
}

export function canonicalStorageFolder(folder: unknown): string {
  const key = fileResourceString(folder).trim().toLowerCase();
  return STORAGE_FOLDER_ALIASES[key] ?? key;
}

export function toServedAssetUrl(rawValue: unknown): string {
  if (typeof rawValue !== 'string') return '';
  const value = rawValue.trim();
  if (!value) return '';
  if (value.startsWith('/api/')) return withActiveVault(value);
  if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;
  if (value.startsWith('Assets/')) {
    return withActiveVault(`/api/vault/assets/${value.slice('Assets/'.length)}`);
  }
  if (value.startsWith('../Assets/')) {
    return withActiveVault(`/api/vault/assets/${value.slice('../Assets/'.length)}`);
  }
  if (value.startsWith('./Assets/')) {
    return withActiveVault(`/api/vault/assets/${value.slice('./Assets/'.length)}`);
  }
  const assetsIndex = value.indexOf('/Assets/');
  if (assetsIndex >= 0) {
    return withActiveVault(`/api/vault/assets/${value.slice(assetsIndex + '/Assets/'.length)}`);
  }
  if (!value.startsWith('/') && !value.includes('://') && !value.includes('..')) {
    return withActiveVault(`/api/vault/assets/${value.replace(/^\.\//, '')}`);
  }
  return '';
}

export function toAssetPreviewUrl(value: unknown): string {
  const normalized = fileResourceString(value).trim().toLowerCase();
  if (!normalized.startsWith('data:image/') && !IMAGE_EXT.test(normalized)) return '';
  return toServedAssetUrl(value);
}

export function isImageFieldName(name: unknown): boolean {
  const normalized = fileResourceString(name);
  if (/\balt\b|\btext\b|\bcaption\b|\bpeu\b|\bllegenda\b|\bleyenda\b|descrip/i.test(normalized)) {
    return false;
  }
  return /(image|imatge|cover|thumbnail|thumb|foto|imagen)/i.test(normalized);
}

export function getImageSrc(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return getImageSrc(value[0]);
  if (!isUnknownRecord(value)) return '';
  return fileResourceString(value.src || value.url || value.path || '');
}

export function parseImageField(value: unknown): ImageFieldValue {
  const src = getImageSrc(value);
  if (isUnknownRecord(value)) {
    return {
      alt: fileResourceString(value.alt),
      caption: fileResourceString(value.caption),
      credit: fileResourceString(value.credit),
      src,
      title: fileResourceString(value.title),
    };
  }
  return { alt: '', caption: '', credit: '', src, title: '' };
}

export function buildImageValue(
  src: unknown,
  extras: ImageFieldExtras = {},
): string | Readonly<Record<string, string>> {
  const output: Record<string, string> = { src: fileResourceString(src).trim() };
  for (const key of ['alt', 'title', 'caption', 'credit'] as const) {
    const value = extras[key];
    const normalized = value == null ? '' : fileResourceString(value).trim();
    if (normalized) output[key] = normalized;
  }
  return Object.keys(output).length === 1 ? output.src ?? '' : output;
}

export function servedUrlToVaultPath(url: unknown): string {
  const value = fileResourceString(url);
  const prefix = '/api/vault/assets/';
  return value.startsWith(prefix)
    ? value.slice(prefix.length).split('?')[0] ?? ''
    : value;
}

export function filenameFromTarget(target: unknown): string {
  if (!target) return '';
  const noProtocol = fileResourceString(target).replace(/^file:\/\//i, '');
  const withoutQuery = noProtocol.split('?')[0] ?? '';
  const clean = withoutQuery.split('#')[0] ?? '';
  const slashName = clean.split('/').pop() ?? clean;
  const base = slashName.split('\\').pop() || clean;
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
}

export function parseFileEntries(value: unknown): FileEntry[] {
  if (value === undefined || value === null) return [];
  const list: readonly unknown[] = Array.isArray(value) ? value : [value];
  const entries: FileEntry[] = [];
  for (const raw of list) {
    const text = fileResourceString(raw).trim();
    if (!text) continue;
    const markdown = text.match(/\[([^\]]*)\]\(([^)]+)\)/);
    if (markdown) {
      const target = (markdown[2] ?? '').trim();
      entries.push({
        label: (markdown[1] ?? '').trim() || filenameFromTarget(target),
        target,
      });
    } else {
      entries.push({ label: filenameFromTarget(text), target: text });
    }
  }
  return entries;
}

export function fileTargetKey(value: unknown): string {
  let normalized = fileResourceString(value).trim();
  if (!normalized) return '';
  const markdown = normalized.match(/\[[^\]]*\]\(([^)]+)\)/);
  if (markdown) normalized = (markdown[1] ?? '').trim();
  if (/^file:\/\//i.test(normalized)) {
    normalized = normalized.replace(/^file:\/\//i, '');
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // Keep malformed legacy URLs as stored.
    }
  }
  const withoutQuery = normalized.split('?')[0] ?? '';
  normalized = (withoutQuery.split('#')[0] ?? '').replace(/\\/g, '/');
  const served = normalized.match(/^\/api\/vault\/(library|raw|assets)\/(.+)$/);
  if (served) {
    let relative = served[2] ?? '';
    try {
      relative = decodeURIComponent(relative);
    } catch {
      // Keep malformed legacy URLs as stored.
    }
    const servedRoot = served[1] ?? '';
    if (servedRoot === 'assets') return `assets/${relative.toLowerCase()}`;
    const root = servedRoot === 'raw' ? 'vault' : servedRoot;
    return `${root}/${relative.toLowerCase()}`;
  }
  normalized = normalized.replace(/^~\//, '/').replace(/^\/Users\/[^/]+\//, '/');
  const library = normalized.match(/(?:^|\/)Library\/(.+)$/);
  if (library) return `library/${(library[1] ?? '').toLowerCase()}`;
  return normalized.toLowerCase();
}

export function documentResourceKey(value: unknown): string {
  return fileTargetKey(value) || fileResourceString(value).trim();
}

export function documentTabId(value: unknown): string {
  return `pdf:${documentResourceKey(value)}`;
}

export function documentWindowName(value: unknown): string {
  const key = documentResourceKey(value);
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `gnosi-document-${(hash >>> 0).toString(36)}`;
}
