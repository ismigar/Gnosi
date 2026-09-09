import Graph from 'graphology';
import { seededUnitInterval } from './graphViewerModel';
import type { LayoutLink, LayoutNode } from './graphViewerPhysics';
import type { ViewerEdge, ViewerGraph, ViewerNode } from './types';

interface LegacyNode {
    x: number;
    y: number;
    size: number;
    unresolved: boolean;
}

/** Test/benchmark oracle: the layout preparation before removing its graph copy. */
export function buildLegacyVisibleLayout(graph: ViewerGraph) {
    const subgraph = new Graph<LegacyNode, ViewerEdge>();
    graph.forEachNode((node, attrs) => {
        if (!attrs.hidden) {
            subgraph.addNode(node, {
                x: attrs.x || 0,
                y: attrs.y || 0,
                size: attrs.size || 5,
                unresolved: attrs.kind === 'unresolved',
            });
        }
    });
    graph.forEachEdge((_edge, attrs, source, target) => {
        if (!attrs.hidden && subgraph.hasNode(source) && subgraph.hasNode(target) && !subgraph.hasEdge(source, target)) {
            subgraph.addEdge(source, target, attrs);
        }
    });
    if (subgraph.order === 0) return null;

    const nodes: LayoutNode[] = [];
    const nodeById = new Map<string, LayoutNode>();
    subgraph.forEachNode((node, attrs) => {
        const angle = seededUnitInterval(`${node}:angle`) * Math.PI * 2;
        const seedRadius = Math.max(240, Math.sqrt(subgraph.order) * 25);
        const radius = Math.sqrt(seededUnitInterval(`${node}:radius`)) * seedRadius;
        const isolated = subgraph.degree(node) === 0;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        const item = {
            id: node,
            radius: attrs.size || 2,
            unresolved: attrs.unresolved,
            isolated,
            x,
            y,
            ...(isolated ? { fx: x, fy: y } : {}),
        };
        nodes.push(item);
        nodeById.set(node, item);
    });
    const links: LayoutLink[] = [];
    subgraph.forEachEdge((_edge, attrs, source, target) => {
        links.push({ source, target, weight: Number(attrs.weight || 1), unresolved: Boolean(attrs.unresolved) });
    });
    return { nodes, links, nodeById, subgraph };
}

/** Deterministic, entirely synthetic input with hidden nodes/edges and isolates. */
export function buildSyntheticPhysicsGraph(nodeCount: number): ViewerGraph {
    const graph = new Graph<ViewerNode, ViewerEdge>({ multi: true });
    for (let index = 0; index < nodeCount; index++) {
        graph.addNode(`n${String(index)}`, {
            x: index,
            y: -index,
            size: index % 5,
            hidden: index % 19 === 0 && index % 17 !== 0,
            kind: index % 13 === 0 ? 'unresolved' : 'Wiki',
        });
    }
    for (let index = 0; index < nodeCount; index++) {
        if (index % 17 === 0) continue;
        for (const offset of [1, 7, 31]) {
            const target = (index + offset) % nodeCount;
            if (target % 17 === 0) continue;
            const attrs = { weight: index % 4, hidden: index % 11 === 0, unresolved: target % 13 === 0 };
            graph.addDirectedEdge(`n${String(index)}`, `n${String(target)}`, attrs);
            if (index % 23 === 0) graph.addUndirectedEdge(`n${String(index)}`, `n${String(target)}`, { weight: 99 });
        }
        if (index % 29 === 0) graph.addDirectedEdge(`n${String(index)}`, `n${String(index)}`, { weight: 2 });
    }
    return graph;
}
