export interface OutgoingPageLink { readonly id: string; readonly title: string; readonly resolved: boolean; }

export const normalizeLinkedPageRef = (rawRef: string) => {
    const source = rawRef.trim();
    if (!source) return '';

    const decoded = (() => {
        try {
            return decodeURIComponent(source);
        } catch {
            return source;
        }
    })();

    const withoutHash = (decoded.split('#')[0] ?? '').trim();
    if (!withoutHash) return '';

    const vaultPageMatch = withoutHash.match(/(?:https?:\/\/[^/]+)?\/(?:vault|@[^/]+\/knowledge)\/page\/([^/?#]+)/i);
    if (vaultPageMatch?.[1]) {
        try {
            return decodeURIComponent(vaultPageMatch[1]).trim();
        } catch {
            return vaultPageMatch[1].trim();
        }
    }

    const apiPageMatch = withoutHash.match(/(?:https?:\/\/[^/]+)?\/(?:api\/vault|api\/v1\/vaults\/[^/]+\/knowledge)\/pages\/([^/?#]+)/i);
    if (apiPageMatch?.[1]) {
        try {
            return decodeURIComponent(apiPageMatch[1]).trim();
        } catch {
            return apiPageMatch[1].trim();
        }
    }

    return withoutHash;
};

export const extractOutgoingPageLinks = (markdown: string | null | undefined, idToTitle: Readonly<Record<string, string>> = {}, selfId = ''): OutgoingPageLink[] => {
    const titleToId = Object.entries(idToTitle).reduce<Record<string, string>>((acc, [id, title]) => {
        const key = title.trim().toLowerCase();
        if (key && !acc[key]) {
            acc[key] = id.trim();
        }
        return acc;
    }, {});

    const addResolved = (bucket: Map<string, OutgoingPageLink>, targetId: string, fallbackTitle = '') => {
        const safeId = targetId.trim();
        if (!safeId || safeId === selfId.trim()) return;
        if (bucket.has(safeId)) return;
        bucket.set(safeId, {
            id: safeId,
            title: (idToTitle[safeId] || fallbackTitle || safeId),
            resolved: true,
        });
    };

    const unresolved = new Map<string, OutgoingPageLink>();
    const resolved = new Map<string, OutgoingPageLink>();
    const body = (markdown || '');

    const wikiRegex = /!?\[\[([^\]]+)\]\]/g;
    for (const match of body.matchAll(wikiRegex)) {
        const rawTarget = (match[1] || '').trim();
        if (!rawTarget) continue;

        const baseTarget = (rawTarget.split('|')[0]?.split('#')[0] ?? '').trim();
        if (!baseTarget) continue;

        const normalizedRef = normalizeLinkedPageRef(baseTarget);
        const byId = idToTitle[normalizedRef] ? normalizedRef : '';
        const byTitle = titleToId[baseTarget.toLowerCase()] || '';
        const resolvedId = byId || byTitle;

        if (resolvedId) {
            addResolved(resolved, resolvedId, baseTarget);
            continue;
        }

        const key = baseTarget.toLowerCase();
        if (!unresolved.has(key)) {
            unresolved.set(key, {
                id: '',
                title: baseTarget,
                resolved: false,
            });
        }
    }

    const mdRegex = /\[[^\]]*\]\(([^)]+)\)/g;
    for (const match of body.matchAll(mdRegex)) {
        // Exclude Markdown images `![alt](src)`: the `!` immediately before
        // of the bracket marks an IMAGE, not a link to a page. Without this,
        // an image with a relative path or `file://` (which doesn't pass the filter
        // http/`/` further below) was added as an outgoing link that was NOT resolved.
        if (match.index > 0 && body[match.index - 1] === '!') continue;
        const rawRef = (match[1] || '').trim();
        if (!rawRef) continue;

        const normalizedRef = normalizeLinkedPageRef(rawRef);
        if (!normalizedRef) continue;

        const byId = idToTitle[normalizedRef] ? normalizedRef : '';
        const byTitle = titleToId[normalizedRef.toLowerCase()] || '';
        const resolvedId = byId || byTitle;

        if (resolvedId) {
            addResolved(resolved, resolvedId, normalizedRef);
            continue;
        }

        if (rawRef.startsWith('http://') || rawRef.startsWith('https://') || rawRef.startsWith('/')) {
            continue;
        }

        const key = normalizedRef.toLowerCase();
        if (!unresolved.has(key)) {
            unresolved.set(key, {
                id: '',
                title: normalizedRef,
                resolved: false,
            });
        }
    }

    return [
        ...Array.from(resolved.values()).sort((a, b) => a.title.localeCompare(b.title)),
        ...Array.from(unresolved.values()).sort((a, b) => a.title.localeCompare(b.title)),
    ];
};
