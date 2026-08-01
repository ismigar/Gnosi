export const CONNECTION_TYPE_COLORS = {
    wikilink: '#10b981',
    database_wikilink: '#6366f1',
    unresolved: '#cbd5e1',
    semantic_similarity: '#a855f7',
};

export function getConnectionType(attrs) {
    if (attrs.unresolved) return 'unresolved';
    if (attrs.kind === 'suggestion') return 'semantic_similarity';
    if (attrs.kind === 'relation') return 'database_wikilink';
    return 'wikilink';
}

export function getConnectionTypeCounts(edgeAttributes) {
    return edgeAttributes.reduce((counts, attrs) => {
        const type = getConnectionType(attrs);
        counts[type] = (counts[type] || 0) + 1;
        return counts;
    }, {});
}
