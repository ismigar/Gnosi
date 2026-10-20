import type { PublicationBundle } from '../../../shared/api/vault-publishing';

export function headingId(text: string): string {
    return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/gu, '-');
}

export type PublishedLink = { readonly pageId: string; readonly fragment: string } | { readonly external: string };

export function publishedLink(raw: string, bundle: PublicationBundle): PublishedLink | null {
    const local = /^gnosi-published:(p[1-9]\d*)(?:#(.*))?$/u.exec(raw);
    if (local) {
        if (!bundle.pages.some(page => page.id === local[1])) return null;
        try { return { pageId: local[1] ?? '', fragment: decodeURIComponent(local[2] ?? '') }; }
        catch { return null; }
    }
    try {
        const url = new URL(raw);
        if (!['http:', 'https:', 'mailto:'].includes(url.protocol) || url.username || url.password) return null;
        for (const character of raw) {
            if (character.charCodeAt(0) <= 32 || character === '\\') return null;
        }
        if (url.origin === window.location.origin) return null;
        if (/\/(?:api|@[^/]+|vault|knowledge|assets|files|raw)(?:\/|$)/iu.test(decodeURIComponent(url.pathname))) return null;
        return { external: url.href };
    } catch { return null; }
}
