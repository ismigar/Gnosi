import { applyFilters } from './graphFilters';
import { getConnectionType } from './graphLegend';
import { getVisibleSemanticEdges } from './semanticOverlay';

function normalizedReason(attrs) {
    const raw = attrs.reason || attrs.reasons || attrs.evidence || '';
    return Array.isArray(raw) ? raw.filter(Boolean).join(', ') : String(raw || '');
}

export function getVisibleConnectionGroups(graph, filters, transportEdges = []) {
    if (!graph) return [];

    const { visibleNodes, visibleEdges } = applyFilters(graph, filters);
    const groups = new Map();

    const addConnection = (id, source, target, attrs) => {
        if (!graph.hasNode(source) || !graph.hasNode(target)) return;
        const sourceAttrs = graph.getNodeAttributes(source);
        const targetAttrs = graph.getNodeAttributes(target);
        if (!groups.has(source)) {
            groups.set(source, {
                id: source,
                label: sourceAttrs.label || source,
                url: sourceAttrs.url,
                targets: [],
            });
        }
        groups.get(source).targets.push({
            id,
            label: targetAttrs.label || target,
            url: targetAttrs.url,
            type: getConnectionType(attrs),
            directed: Boolean(attrs.directed),
            reason: normalizedReason(attrs),
        });
    };

    visibleEdges.forEach((edge) => {
        addConnection(
            edge,
            graph.source(edge),
            graph.target(edge),
            graph.getEdgeAttributes(edge),
        );
    });

    getVisibleSemanticEdges(
        transportEdges,
        visibleNodes,
        filters?.showSemanticSuggestions,
    ).forEach((edge, index) => {
        const source = String(edge.source);
        const target = String(edge.target);
        addConnection(
            `semantic:${edge.suggestion_id || index}:${source}:${target}`,
            source,
            target,
            { ...edge, directed: false },
        );
    });

    groups.forEach((group) => {
        group.targets.sort((left, right) => (
            left.type.localeCompare(right.type)
            || left.label.localeCompare(right.label)
        ));
    });

    return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label));
}
