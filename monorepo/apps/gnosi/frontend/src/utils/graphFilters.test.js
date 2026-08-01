import { describe, expect, it } from 'vitest';
import Graph from 'graphology';
import { applyFilters, getVisibleHoverNeighborhood } from './graphFilters';

function buildCrossTableGraph() {
    const graph = new Graph();
    graph.addNode('source', {
        kind: 'page',
        table_id: 'table-a',
        database_id: 'db',
    });
    graph.addNode('target', {
        kind: 'page',
        table_id: 'table-b',
        database_id: 'db',
    });
    graph.addEdge('source', 'target', { kind: 'link' });
    return graph;
}

describe('cross-table graph filtering', () => {
    it('does not invent a placeholder when the real target is outside the visible table', () => {
        const graph = buildCrossTableGraph();
        const { visibleNodes, visibleEdges } = applyFilters(graph, {
            visibleTables: ['table-a'],
            sourcesInitialized: true,
        });

        expect([...visibleNodes]).toEqual(['source']);
        expect(visibleEdges.size).toBe(0);
    });

    it('shows the real edge when both endpoints are visible', () => {
        const graph = buildCrossTableGraph();
        const { visibleNodes, visibleEdges } = applyFilters(graph, {
            visibleTables: ['table-a', 'table-b'],
            sourcesInitialized: true,
        });

        expect([...visibleNodes].sort()).toEqual(['source', 'target']);
        expect(visibleEdges.size).toBe(1);
        const edge = [...visibleEdges][0];
        expect(graph.hasExtremity(edge, 'target')).toBe(true);
    });
});

describe('visible graph topology', () => {
    function buildSimilarityGraph() {
        const graph = new Graph();
        graph.addNode('a', { kind: 'page' });
        graph.addNode('b', { kind: 'page' });
        graph.addNode('c', { kind: 'page' });
        graph.addNode('d', { kind: 'page' });
        graph.addEdge('a', 'b', { kind: 'semantic_similarity', similarity: 80 });
        graph.addEdge('c', 'd', { kind: 'link' });
        return graph;
    }

    it('treats nodes with only filtered-out edges as visibly isolated', () => {
        const graph = buildSimilarityGraph();
        const { visibleNodes, visibleEdges } = applyFilters(graph, {
            similarity: 100,
            onlyIsolated: true,
        });

        expect([...visibleNodes].sort()).toEqual(['a', 'b']);
        expect(visibleEdges.size).toBe(0);
    });

    it('hides nodes with only filtered-out edges when hiding isolates', () => {
        const graph = buildSimilarityGraph();
        const { visibleNodes, visibleEdges } = applyFilters(graph, {
            similarity: 100,
            hideIsolated: true,
        });

        expect([...visibleNodes].sort()).toEqual(['c', 'd']);
        expect(visibleEdges.size).toBe(1);
    });

    it('never promotes semantic proposals into the structural topology', () => {
        const graph = buildSimilarityGraph();
        const { visibleNodes, visibleEdges } = applyFilters(graph, {
            similarity: 0,
            onlyIsolated: true,
        });

        expect([...visibleNodes].sort()).toEqual(['a', 'b']);
        expect(visibleEdges.size).toBe(0);
    });

    it('prefers only-isolated mode if both isolation flags are supplied', () => {
        const graph = buildSimilarityGraph();
        const { visibleNodes, visibleEdges } = applyFilters(graph, {
            similarity: 100,
            hideIsolated: true,
            onlyIsolated: true,
        });

        expect([...visibleNodes].sort()).toEqual(['a', 'b']);
        expect(visibleEdges.size).toBe(0);
    });

    it('excludes hidden edges and nodes from the hover neighborhood', () => {
        const graph = buildSimilarityGraph();
        graph.setEdgeAttribute(graph.edge('a', 'b'), 'hidden', true);
        graph.setNodeAttribute('b', 'hidden', true);

        const neighborhood = getVisibleHoverNeighborhood(graph, 'a');

        expect([...neighborhood.nodes]).toEqual(['a']);
        expect(neighborhood.edges.size).toBe(0);
    });

    it('does not highlight any edge when hovering an isolated node', () => {
        const graph = buildSimilarityGraph();
        graph.addNode('isolated', { kind: 'page' });

        const neighborhood = getVisibleHoverNeighborhood(graph, 'isolated');

        expect([...neighborhood.nodes]).toEqual(['isolated']);
        expect(neighborhood.edges.size).toBe(0);
    });

    it('does not treat a semantic proposal as a hover connection', () => {
        const graph = buildSimilarityGraph();

        const neighborhood = getVisibleHoverNeighborhood(graph, 'a');

        expect([...neighborhood.nodes]).toEqual(['a']);
        expect(neighborhood.edges.size).toBe(0);
    });
});
