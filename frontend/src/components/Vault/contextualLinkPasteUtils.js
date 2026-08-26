/** Returns one standalone HTTP(S) URL, or an empty string for other clipboard text. */
export function normalizeStandaloneHttpUrl(value) {
    const text = String(value || '').trim();
    if (!text || /\s/.test(text)) return '';
    try {
        const parsed = new URL(text);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch {
        return '';
    }
}

/** Returns the stable page id when a URL points at a Vault page on this Gnosi origin. */
export function extractInternalPageId(value, currentOrigin = '') {
    try {
        const parsed = new URL(String(value || ''));
        const expectedOrigin = String(currentOrigin || '').replace(/\/$/, '');
        if (expectedOrigin && parsed.origin !== expectedOrigin) return '';
        const match = parsed.pathname.match(/^(?:\/vault|\/@[^/]+\/knowledge)\/page\/([^/]+)\/?$/);
        return match ? decodeURIComponent(match[1]) : '';
    } catch {
        return '';
    }
}

/** Creates a deterministic compact label when link metadata is unavailable. */
export function compactUrlLabel(value) {
    try {
        const parsed = new URL(String(value || ''));
        const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
        return `${parsed.hostname.replace(/^www\./, '')}${path}`;
    } catch {
        return String(value || '');
    }
}

/** Only inline-content blocks with no visible content qualify for the chooser. */
export function isEmptyInlineBlock(block) {
    if (!block || !Array.isArray(block.content)) return false;
    return block.content.every((item) => {
        if (typeof item === 'string') return item.trim() === '';
        if (!item || item.type !== 'text') return false;
        return String(item.text || '').trim() === '';
    });
}
