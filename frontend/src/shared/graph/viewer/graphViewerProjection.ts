import { applyFilters } from '../filtering/graphFilters';
import { getVisibleSemanticEdges } from '../model/semanticOverlay';
import { logError } from '../../notifications/notifyError';
import { seededUnitInterval, transportAttributes } from './graphViewerModel';
import type { ViewerGraph, ViewerFilters, GraphViewerProps } from './types';
export function rebuildProjection(graph: ViewerGraph, graphData: NonNullable<GraphViewerProps['graphData']>): void {
    // Rebuild the transport projection and seed it deterministically.
    graph.clear();
    // Initial positions: uniform distribution over a large area → FA2 converges better
    const totalNodes = graphData.nodes.length;
    const spreadRadius = Math.max(300, Math.sqrt(totalNodes) * 40);
    graphData.nodes.forEach((n) => {
        const key = String(n.key);
        const rawSize = n.size || 8;
        const displaySize = 1.0 + (rawSize - 8) * (2.0 / 10); // map [8,18]→[1,3]
        const angle = seededUnitInterval(`${key}:initial-angle`) * Math.PI * 2;
        const radius = Math.sqrt(seededUnitInterval(`${key}:initial-radius`)) * spreadRadius;
        const nx = Math.cos(angle) * radius;
        const ny = Math.sin(angle) * radius;
        graph.addNode(key, {
            ...transportAttributes(n),
            x: nx,
            y: ny,
            size: Math.max(1, Math.min(3, displaySize)),
        });
    });
    graphData.edges.forEach(e => {
        // Render every body wikilink, including one that also belongs to a
        // database-view relation. Frontmatter-only relations, structural
        // hierarchy, and semantic proposal edges remain excluded.
        if (e.kind !== 'link' && !e.body_link)
            return;
        const source = String(e.source);
        const target = String(e.target);
        if (!graph.hasNode(source) || !graph.hasNode(target))
            return;
        // Prevent graphology crash on duplicate edges in simple graphs
        if (graph.hasEdge(source, target))
            return;
        try {
            if (e.directed) {
                graph.addDirectedEdge(source, target, e);
            }
            else {
                graph.addUndirectedEdge(source, target, e);
            }
        }
        catch (err) {
            logError('graph-edge-add', err);
        }
    });
}
export function filterProjection(graph: ViewerGraph, filters: ViewerFilters | undefined, graphData: GraphViewerProps['graphData']) {
    const { visibleNodes, visibleEdges } = applyFilters(graph, filters ?? {});
    const semanticEdges = getVisibleSemanticEdges(graphData?.edges, visibleNodes, filters?.showSemanticSuggestions);
    const visibleDegree = new Map<string, number>();
    visibleEdges.forEach((edge) => {
        const source = graph.source(edge);
        const target = graph.target(edge);
        visibleDegree.set(source, (visibleDegree.get(source) || 0) + 1);
        visibleDegree.set(target, (visibleDegree.get(target) || 0) + 1);
    });
    // Obsidian sizes nodes by the number of visible connections. Apply the
    // same rule in one Graphology event so hubs stand out without flooding
    // Sigma and the minimap with per-node updates.
    graph.updateEachNodeAttributes((node, attrs) => {
        const hidden = !visibleNodes.has(node);
        const degree = visibleDegree.get(node) || 0;
        const isolated = degree === 0 && attrs.kind !== 'unresolved';
        const size = attrs.kind === 'unresolved'
            ? 0.5
            : isolated
                ? (filters?.onlyIsolated ? 3 : 2.1)
                : Math.min(3.2, 0.7 + Math.sqrt(degree) * 0.27);
        return { ...attrs, hidden, isolated, size };
    }, { attributes: ['hidden', 'isolated', 'size'] });
    graph.updateEachEdgeAttributes((edge, attrs) => {
        return { ...attrs, hidden: !visibleEdges.has(edge) };
    }, { attributes: ['hidden'] });
    return semanticEdges;
}
