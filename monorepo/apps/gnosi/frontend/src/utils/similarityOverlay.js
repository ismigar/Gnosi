const toPercentage = (value) => {
    const score = Number(value);
    if (!Number.isFinite(score)) return null;
    return score <= 1 ? score * 100 : score;
};

export const SEMANTIC_SUGGESTION_COLOR = '#a855f7';

export function hasSemanticSuggestions(edges) {
    return (edges || []).some((edge) => edge.kind === 'suggestion');
}

/**
 * Returns semantic suggestion edges that may be painted over the real-link
 * topology. The caller owns the topology graph, so these edges never enter
 * layout, degree, camera, or minimap calculations.
 */
export function getVisibleSimilarityEdges(edges, visibleNodes, threshold) {
    const minimum = Number(threshold);
    if (!Number.isFinite(minimum) || minimum >= 100) return [];

    return (edges || []).filter((edge) => {
        if (edge.kind !== 'suggestion') return false;
        const score = toPercentage(edge.similarity);
        if (score === null || score < minimum) return false;
        return visibleNodes.has(String(edge.source)) && visibleNodes.has(String(edge.target));
    });
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

export function getSimilarityPercentage(edge) {
    return toPercentage(edge.similarity);
}
