import { describe, expect, it } from 'vitest';
import Graph from 'graphology';
import { applyFilters } from './graphFilters';

function buildScopedGraph() {
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
    graph.addNode('placeholder', {
        kind: 'unresolved',
        table_id: 'table-a',
        database_id: 'db',
        metadata: {
            unresolved: true,
            scope_only: true,
            resolved_target_id: 'target',
        },
    });
    graph.addEdge('source', 'target', { kind: 'link' });
    graph.addEdge('source', 'placeholder', { kind: 'link', scope_only: true });
    return graph;
}

describe('graph unresolved scope filtering', () => {
    it('shows the placeholder when its real target is outside the visible table', () => {
        const graph = buildScopedGraph();
        const { visibleNodes, visibleEdges } = applyFilters(graph, {
            visibleTables: ['table-a'],
            sourcesInitialized: true,
        });

        expect([...visibleNodes].sort()).toEqual(['placeholder', 'source']);
        expect(visibleEdges.size).toBe(1);
        const edge = [...visibleEdges][0];
        expect(graph.hasExtremity(edge, 'placeholder')).toBe(true);
    });

    it('hides the placeholder when both source and real target are visible', () => {
        const graph = buildScopedGraph();
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
