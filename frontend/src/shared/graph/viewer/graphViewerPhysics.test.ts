// @vitest-environment node
import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import { buildVisibleLayout } from './graphViewerPhysics';
import { buildLegacyVisibleLayout, buildSyntheticPhysicsGraph } from './graphViewerPhysicsFixtures';
import type { ViewerEdge, ViewerGraph, ViewerNode } from './types';

function expectLegacyLayout(graph: ViewerGraph) {
    const actual = buildVisibleLayout(graph);
    const legacy = buildLegacyVisibleLayout(graph);
    expect(actual).not.toBeNull();
    expect(legacy).not.toBeNull();
    if (!actual || !legacy) throw new Error('Expected visible layout');
    expect(actual.nodes).toEqual(legacy.nodes);
    expect(actual.links).toEqual(legacy.links);
    expect(actual.nodeById).toEqual(legacy.nodeById);
    for (const node of actual.nodes) {
        expect(actual.degreeById.get(node.id)).toBe(legacy.subgraph.degree(node.id));
        expect(actual.nodeById.get(node.id)).toBe(node);
    }
    return actual;
}

describe('visible physics inputs', () => {
    it('preserves first ordered edges, reverse edges, loops, hidden endpoints and isolate pinning', () => {
        const graph = new Graph<ViewerNode, ViewerEdge>({ multi: true });
        graph.addNode('a', { x: 12, y: 21, size: 0 });
        graph.addNode('b', { x: -3, y: 8, size: 8 });
        graph.addNode('c', { x: 2, y: 7, size: -2 });
        graph.addNode('u', { x: 10, y: -7, size: 3, kind: 'unresolved' });
        graph.addNode('isolated', { x: 99, y: 101 });
        graph.addNode('hidden', { x: 0, y: 0, hidden: true });
        graph.addDirectedEdge('a', 'b', { hidden: true, weight: 70 });
        graph.addDirectedEdge('a', 'b', { weight: 2 });
        graph.addDirectedEdge('a', 'b', { weight: 99 });
        graph.addUndirectedEdge('a', 'b', { weight: 100 });
        graph.addDirectedEdge('b', 'a', { weight: 3 });
        graph.addUndirectedEdge('c', 'c', { weight: 4 });
        graph.addDirectedEdge('c', 'c', { weight: 200 });
        graph.addDirectedEdge('a', 'hidden', { weight: 7 });
        graph.addDirectedEdge('hidden', 'b', { weight: 7 });
        graph.addDirectedEdge('b', 'isolated', { hidden: true });
        graph.addDirectedEdge('b', 'u', { weight: 0, unresolved: 'true' });
        graph.addUndirectedEdge('u', 'c', { weight: '2.5' });
        const original = graph.export();

        const layout = expectLegacyLayout(graph);

        expect(layout.links).toEqual([
            { source: 'a', target: 'b', weight: 2, unresolved: false },
            { source: 'b', target: 'a', weight: 3, unresolved: false },
            { source: 'c', target: 'c', weight: 4, unresolved: false },
            { source: 'b', target: 'u', weight: 1, unresolved: true },
            { source: 'u', target: 'c', weight: 2.5, unresolved: false },
        ]);
        expect(Object.fromEntries(layout.degreeById)).toEqual({ a: 2, b: 3, c: 3, u: 2, isolated: 0 });
        expect(layout.nodeById.get('a')?.radius).toBe(5);
        expect(layout.nodeById.get('u')?.unresolved).toBe(true);
        expect(layout.nodes.filter(node => node.isolated).map(node => node.id)).toEqual(['isolated']);
        const isolate = layout.nodeById.get('isolated');
        expect(isolate).toMatchObject({ fx: isolate?.x, fy: isolate?.y, radius: 5 });
        expect(graph.export()).toEqual(original);
    });

    it('matches the previous inputs and degrees on a larger mixed synthetic graph', () => {
        expectLegacyLayout(buildSyntheticPhysicsGraph(1000));
    });

    it('rebuilds from the current visibility without retaining prior nodes or connections', () => {
        const graph = new Graph<ViewerNode, ViewerEdge>();
        graph.addNode('a', { x: 0, y: 0 });
        graph.addNode('b', { x: 0, y: 0 });
        graph.addEdge('a', 'b');
        const first = expectLegacyLayout(graph);
        graph.setNodeAttribute('b', 'hidden', true);

        const second = expectLegacyLayout(graph);

        expect(first.nodes).toHaveLength(2);
        expect(first.links).toHaveLength(1);
        expect(second.nodes).toHaveLength(1);
        expect(second.links).toHaveLength(0);
        expect(second.nodes[0]?.isolated).toBe(true);
        graph.setNodeAttribute('b', 'hidden', false);
        expect(expectLegacyLayout(graph).nodes).toEqual(first.nodes);
    });

    it('returns no simulation input for an empty or fully hidden graph', () => {
        const graph = new Graph<ViewerNode, ViewerEdge>();
        expect(buildVisibleLayout(graph)).toBeNull();
        graph.addNode('hidden', { x: 0, y: 0, hidden: true });
        graph.addEdge('hidden', 'hidden');
        expect(buildVisibleLayout(graph)).toBeNull();
        expect(buildLegacyVisibleLayout(graph)).toBeNull();
    });
});
