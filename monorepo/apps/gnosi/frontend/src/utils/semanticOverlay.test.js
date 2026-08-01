import { describe, expect, it } from 'vitest';
import {
    getSemanticOverlaySegments,
    getVisibleSemanticEdges,
    hasSemanticSuggestions,
} from './semanticOverlay';

describe('semantic proposal overlay', () => {
    const edges = [
        { source: 'a', target: 'b', kind: 'suggestion', reason: 'Shared concern' },
        { source: 'a', target: 'c', kind: 'suggestion', reason: 'Related evidence' },
        { source: 'a', target: 'b', kind: 'link' },
    ];

    it('only returns enabled proposals between visible structural nodes', () => {
        expect(getVisibleSemanticEdges(edges, new Set(['a', 'b']), true)).toEqual([edges[0]]);
        expect(getVisibleSemanticEdges(edges, new Set(['a', 'b', 'c']), false)).toEqual([]);
    });

    it('reports whether the transport contains a semantic proposal layer', () => {
        expect(hasSemanticSuggestions(edges)).toBe(true);
        expect(hasSemanticSuggestions(edges.filter((edge) => edge.kind !== 'suggestion'))).toBe(false);
    });

    it('projects visible proposals without mutating the structural graph', () => {
        const nodes = new Map([
            ['a', { x: 1, y: 2 }],
            ['b', { x: 3, y: 4 }],
            ['c', { x: 5, y: 6, hidden: true }],
        ]);
        const graph = {
            hasNode: (node) => nodes.has(node),
            getNodeAttributes: (node) => nodes.get(node),
        };

        expect(getSemanticOverlaySegments(
            edges,
            graph,
            ({ x, y }) => ({ x: x * 10, y: y * 10 }),
        )).toEqual([{
            edge: edges[0],
            source: { x: 10, y: 20 },
            target: { x: 30, y: 40 },
        }]);
    });
});
