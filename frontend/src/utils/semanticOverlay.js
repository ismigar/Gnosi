export const SEMANTIC_SUGGESTION_COLOR = '#a855f7';

export function hasSemanticSuggestions(edges) {
    return (edges || []).some((edge) => edge.kind === 'suggestion');
}

/**
 * Returns pending Brain proposals whose endpoints belong to the current
 * structural view. Proposal visibility is boolean because the canonical queue
 * does not contain a measured similarity score.
 */
export function getVisibleSemanticEdges(edges, visibleNodes, enabled) {
    if (!enabled) return [];

    return (edges || []).filter((edge) => (
        edge.kind === 'suggestion'
        && visibleNodes.has(String(edge.source))
        && visibleNodes.has(String(edge.target))
    ));
}

/**
 * Resolves visible semantic proposals into viewport segments without adding
 * them to the structural Graphology instance.
 */
export function getSemanticOverlaySegments(edges, graph, graphToViewport) {
    if (!graph || typeof graphToViewport !== 'function') return [];

    return (edges || []).flatMap((edge) => {
        if (edge.kind !== 'suggestion') return [];
        const source = String(edge.source);
        const target = String(edge.target);
        if (!graph.hasNode(source) || !graph.hasNode(target)) return [];

        const sourceAttrs = graph.getNodeAttributes(source);
        const targetAttrs = graph.getNodeAttributes(target);
        if (sourceAttrs.hidden || targetAttrs.hidden) return [];

        const sourceX = Number(sourceAttrs.x);
        const sourceY = Number(sourceAttrs.y);
        const targetX = Number(targetAttrs.x);
        const targetY = Number(targetAttrs.y);
        if (![sourceX, sourceY, targetX, targetY].every(Number.isFinite)) return [];

        return [{
            edge,
            source: graphToViewport({ x: sourceX, y: sourceY }),
            target: graphToViewport({ x: targetX, y: targetY }),
        }];
    });
}
