import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import { seededUnitInterval, stringToColor, transportAttributes } from './graphViewerModel';
import { filterProjection, rebuildProjection } from './graphViewerProjection';
import { createPhysics } from './graphViewerPhysics';
import { createReducers } from './graphViewerReducers';
import { createSettings } from './graphViewerSettings';
import { fixtureData, fixtureEdge, fixtureNode, fixtureOptions } from './graphViewerFixtures';
import type { ViewerGraph, ViewerNode } from './types';
describe('GraphViewer projection and filters', () => {
    it('preserves transport identity, metadata and numeric IDs while seeding deterministically', () => {
        const graph: ViewerGraph = new Graph<ViewerNode>();
        const data = fixtureData();
        const metadata = { Tags: ['deep'], score: 4 };
        data.nodes[0] = fixtureNode('a', { database_id: 42, table_id: false, metadata, size: 18 });
        rebuildProjection(graph, data);
        const attrs = graph.getNodeAttributes('a');
        expect(attrs.metadata).toBe(metadata);
        expect(attrs.database_id).toBe(42);
        expect(attrs.table_id).toBe(false);
        expect(attrs.size).toBe(3);
        const position = [attrs.x, attrs.y];
        rebuildProjection(graph, data);
        expect([graph.getNodeAttribute('a', 'x'), graph.getNodeAttribute('a', 'y')]).toEqual(position);
        expect(seededUnitInterval('a')).toBe(seededUnitInterval('a'));
        expect(stringToColor('cluster')).toMatch(/^#[0-9a-f]{6}$/);
    });
    it('deduplicates structural edges and excludes dangling, hierarchy and semantic edges', () => {
        const graph: ViewerGraph = new Graph<ViewerNode>();
        const data = fixtureData();
        data.edges.push(fixtureEdge('a', 'b'), fixtureEdge('a', 'missing'), fixtureEdge('a', 'isolated', { kind: 'suggestion', body_link: false }), fixtureEdge('isolated', 'b', { kind: 'hierarchy', body_link: false }));
        rebuildProjection(graph, data);
        expect(graph.size).toBe(1);
        const proposals = filterProjection(graph, { showSemanticSuggestions: true }, data);
        expect(proposals).toHaveLength(1);
        expect(graph.getNodeAttributes('isolated')).toMatchObject({ isolated: true, size: 2.1, hidden: false });
        filterProjection(graph, { onlyIsolated: true }, data);
        expect(graph.getNodeAttributes('isolated')).toMatchObject({ hidden: false, size: 3 });
        expect(graph.getNodeAttribute('a', 'hidden')).toBe(true);
    });
    it('preserves body links in non-link relations and undirected transport', () => {
        const graph: ViewerGraph = new Graph<ViewerNode>();
        const data = fixtureData();
        data.edges = [fixtureEdge('a', 'b', { kind: 'relation', directed: false })];
        rebuildProjection(graph, data);
        expect(graph.undirectedSize).toBe(1);
        filterProjection(graph, { searchTerm: 'a' }, data);
        expect(graph.getNodeAttribute('b', 'hidden')).toBe(true);
    });
    it('rejects non-transport functions without rewriting valid nested values', () => {
        expect(() => transportAttributes({ invalid: () => 1 })).toThrow(TypeError);
        expect(transportAttributes({ a: [null, false, 4], b: { c: 'd' } })).toEqual({ a: [null, false, 4], b: { c: 'd' } });
    });
});
describe('GraphViewer physics and appearance', () => {
    it('pins isolates at deterministic positions and moves connected nodes only in the visible subgraph', () => {
        const graph: ViewerGraph = new Graph<ViewerNode>();
        const options = fixtureOptions();
        rebuildProjection(graph, fixtureData());
        filterProjection(graph, {}, fixtureData());
        const physics = createPhysics(graph, options);
        expect(physics).not.toBeNull();
        if (!physics)
            throw new Error('Expected visible simulation');
        const isolate = physics.simulationNodeById.get('isolated');
        const initial = [isolate?.x, isolate?.y];
        physics.simulation.tick(8);
        expect([isolate?.x, isolate?.y]).toEqual(initial);
        expect(isolate?.fx).toBe(isolate?.x);
        for (const node of physics.simulationNodeById.values())
            expect(Number.isFinite(node.x + node.y)).toBe(true);
        physics.simulation.stop();
        filterProjection(graph, { searchTerm: 'no-match' }, fixtureData());
        expect(createPhysics(graph, options)).toBeNull();
    });
    it('keeps path, hover, isolate, color and size precedence', () => {
        const options = { current: fixtureOptions({ nodeSize: 2, isDarkMode: true }) };
        const hover = { node: null, distances: {}, edges: new Set<string>() };
        const reducers = createReducers(options, hover, options.current);
        const node: ViewerNode = { x: 0, y: 0, size: 2, label: 'a', isolated: true };
        expect(reducers.nodeReducer('a', node)).toMatchObject({ size: 4, color: '#60a5fa' });
        options.current.filters = { pathResult: { nodes: new Set(['b']), edges: new Set(['edge']) } };
        expect(reducers.nodeReducer('a', node)).toMatchObject({ opacity: 0.1, label: '', size: 2 });
        expect(reducers.edgeReducer('edge', {})).toMatchObject({ color: '#3498db', size: 3 });
        expect(reducers.nodeReducer('a', { ...node, hidden: true })).toMatchObject({ hidden: true, label: '' });
    });
    it('retains legacy ignored Sigma settings instead of activating a different label renderer', () => {
        const options = { current: fixtureOptions() };
        const settings = createSettings(options, { node: null, distances: {}, edges: new Set() }, options.current);
        expect(settings.defaultEdgeType).toBe('line');
        expect(settings.defaultDrawNodeLabel).toBeUndefined();
        expect(typeof settings.labelRenderer).toBe('function');
        expect(settings.labelDensity).toBe(0.005);
        expect(settings).toMatchObject({ renderEdges: true, minArrowSize: 3, maxArrowSize: 6 });
    });
});
