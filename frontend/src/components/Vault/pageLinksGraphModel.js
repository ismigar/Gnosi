const KIND_ORDER = ['outgoing', 'incoming', 'relation'];

export function truncateGraphLabel(value, maxCharacters = 22) {
    const label = String(value || '').trim();
    if (label.length <= maxCharacters) return label;
    return `${label.slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`;
}

function connectionKey(item, kind) {
    const id = String(item?.id || '').trim();
    if (id) return `id:${id}`;
    return `${kind}:title:${String(item?.title || '').trim().toLocaleLowerCase()}`;
}

export function buildPageLinksGraphModel({ outgoingLinks = [], incomingLinks = [], relatedPages = [] }) {
    const nodesByKey = new Map();
    const addItems = (items, kind) => {
        for (const item of Array.isArray(items) ? items : []) {
            const title = String(item?.title || item?.id || '').trim();
            if (!title) continue;
            const key = connectionKey(item, kind);
            const existing = nodesByKey.get(key);
            if (existing) {
                existing.kinds.add(kind);
                continue;
            }
            nodesByKey.set(key, {
                key,
                id: String(item?.id || '').trim(),
                title,
                kinds: new Set([kind]),
            });
        }
    };

    addItems(outgoingLinks, 'outgoing');
    addItems(incomingLinks, 'incoming');
    addItems(relatedPages, 'relation');

    return Array.from(nodesByKey.values())
        .map((node) => {
            const kinds = KIND_ORDER.filter((kind) => node.kinds.has(kind));
            return {
                ...node,
                kinds,
                visualKind: kinds.length === 1 ? kinds[0] : 'mixed',
            };
        })
        .sort((a, b) => a.title.localeCompare(b.title));
}
