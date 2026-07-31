export function getConnectionTypeCounts(edgeAttributes) {
    return edgeAttributes.reduce((counts, attrs) => {
        const type = attrs.unresolved
            ? 'unresolved'
            : attrs.kind === 'relation'
                ? 'database_wikilink'
                : 'wikilink';
        counts[type] = (counts[type] || 0) + 1;
        return counts;
    }, {});
}
