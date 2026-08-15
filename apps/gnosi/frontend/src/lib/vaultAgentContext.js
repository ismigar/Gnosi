const stableRef = (prefix, value) => `${prefix}:${String(value)}`;

export function vaultPageViewIds(page = null) {
    const content = String(page?.content || '');
    const viewIds = [];
    const marker = /<!--\s*gnosi-view:def\s+(\{[\s\S]*?\})\s*-->/g;
    let match = marker.exec(content);
    while (match) {
        try {
            const viewId = String(JSON.parse(match[1])?.view_id || '').trim();
            if (viewId && !viewIds.includes(viewId)) viewIds.push(viewId);
        } catch {
            // Ignore malformed page-owned markers; the page remains valid context.
        }
        match = marker.exec(content);
    }
    return viewIds;
}

export function vaultAgentContextRefs({ page = null, table = null, view = null } = {}) {
    const refs = [];
    const pageId = String(page?.id || '').trim();
    const tableId = String(table?.id || '').trim();
    const viewId = String(view?.id || '').trim();

    if (pageId) {
        refs.push({
            id: stableRef('vault-page', pageId),
            type: 'page',
            ref: pageId,
            label: String(page?.title || page?.name || pageId),
        });
    }
    if (tableId) {
        const tableRef = {
            id: stableRef('vault-table', tableId),
            type: 'table',
            ref: tableId,
            label: String(table?.name || table?.title || tableId),
        };
        if (viewId) {
            tableRef.scope = {
                view_id: viewId,
                view_name: String(view?.name || viewId),
            };
        }
        refs.push(tableRef);
    }
    if (!refs.length) {
        refs.push({
            id: 'route-vault',
            type: 'vault',
            ref: 'active-vault',
            label: 'Knowledge',
        });
    }
    return refs;
}
