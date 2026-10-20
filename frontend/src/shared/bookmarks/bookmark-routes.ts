import { getActiveVaultSlug, vaultPath } from '../routing/vaultRouting';

const apps = new Set(['knowledge', 'graph', 'calendar', 'reader', 'mail', 'automations',
  'social', 'media', 'contacts', 'planning', 'resources', 'notebooks']);

export function pageIdFromBookmarkRoute(target: string): string | null {
  const segment = target.match(/^\/knowledge\/(?:page|dashboard)\/([^/?#]+)\/?$/u)?.[1];
  if (!segment) return null;
  try {
    const pageId = decodeURIComponent(segment);
    return isBookmarkPageId(pageId) ? pageId : null;
  } catch { return null; }
}

export function isBookmarkPageId(pageId: string): boolean {
  return pageId.length > 0 && pageId.length <= 2000 && Boolean(pageId.trim())
    && pageId !== '.' && pageId !== '..' && !pageId.includes('/') && !pageId.includes('\\')
    && !Array.from(pageId).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

/** Keep links relative to the vault, whose local slug can differ by device. */
export function isBookmarkRoute(target: string): boolean {
  if (target.length > 2000 || !apps.has(target.match(/^\/([^/?#]+)/u)?.[1] ?? '') || !target.startsWith('/') || target.startsWith('//') || target.includes('\\')
    || Array.from(target).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  let path = target.split(/[?#]/u)[0] ?? '';
  for (let pass = 0; pass < 5; pass++) {
    if (path.includes('\\') || path.split('/').some(segment => segment === '.' || segment === '..')) return false;
    try {
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
      if (pass === 4) return false;
    } catch { return false; }
  }
  return apps.has(path.split('/')[1] ?? '') && !path.startsWith('//')
    && !Array.from(path).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

export function bookmarkRouteHref(target: string): string {
  if (!isBookmarkRoute(target)) return '#';
  // Include query/hash in the resource suffix without changing their encoding.
  const root = target.match(/^\/([^/?#]+)/u)?.[1] ?? '';
  const suffix = target.slice(root.length + 1);
  return suffix.startsWith('/') ? vaultPath(root, suffix.slice(1)) : vaultPath(root) + suffix;
}

export function currentBookmarkRoute(): string | null {
  const prefix = `/@${encodeURIComponent(getActiveVaultSlug())}`;
  if (!getActiveVaultSlug() || !window.location.pathname.startsWith(prefix + '/')) return null;
  const target = window.location.pathname.slice(prefix.length) + window.location.search + window.location.hash;
  return isBookmarkRoute(target) ? target : null;
}

export function bookmarkGraphHref(target: string): string {
  return bookmarkRouteHref(target.replace(/^\/@[^/]+(?=\/graph(?:[/?#]|$))/u, ''));
}
