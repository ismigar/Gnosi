const toPercentage = (value) => {
    const score = Number(value);
    if (!Number.isFinite(score)) return null;
    return score <= 1 ? score * 100 : score;
};

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

export function getSimilarityPercentage(edge) {
    return toPercentage(edge.similarity);
}
