type UrlValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringifyInlineText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean' ||
    typeof value === 'symbol'
  ) {
    return String(value);
  }
  return '[non-empty inline value]';
}

/** Returns one standalone HTTP(S) URL, or an empty string otherwise. */
export function normalizeStandaloneHttpUrl(value?: UrlValue): string {
  const text = String(value || '').trim();
  if (!text || /\s/.test(text)) return '';
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.href
      : '';
  } catch {
    return '';
  }
}

/** Returns the stable id when a URL points at a Vault page on this origin. */
export function extractInternalPageId(
  value?: UrlValue,
  currentOrigin: UrlValue = '',
): string {
  try {
    const parsed = new URL(String(value || ''));
    const expectedOrigin = String(currentOrigin || '').replace(/\/$/, '');
    if (expectedOrigin && parsed.origin !== expectedOrigin) return '';
    const match = parsed.pathname.match(
      /^(?:\/vault|\/@[^/]+\/knowledge)\/page\/([^/]+)\/?$/,
    );
    const encodedPageId = match?.[1];
    return encodedPageId ? decodeURIComponent(encodedPageId) : '';
  } catch {
    return '';
  }
}

/** Creates a deterministic compact label when link metadata is unavailable. */
export function compactUrlLabel(value?: UrlValue): string {
  try {
    const parsed = new URL(String(value || ''));
    const path =
      parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    return `${parsed.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return String(value || '');
  }
}

/** Only inline-content blocks with no visible content qualify for the chooser. */
export function isEmptyInlineBlock(block?: unknown): boolean {
  if (!isUnknownRecord(block)) return false;
  const content = block.content;
  if (!isUnknownArray(content)) return false;
  return content.every((item) => {
    if (typeof item === 'string') return item.trim() === '';
    if (!isUnknownRecord(item) || item.type !== 'text') return false;
    return stringifyInlineText(item.text).trim() === '';
  });
}
