import { describe, expect, it } from 'vitest';
import {
    getSemanticOverlaySegments,
    getVisibleSimilarityEdges,
    hasSemanticSuggestions,
} from './similarityOverlay';

describe('getVisibleSimilarityEdges', () => {
    const edges = [
        { source: 'a', target: 'b', kind: 'suggestion', similarity: 88 },
        { source: 'a', target: 'c', kind: 'suggestion', similarity: 0.76 },
        { source: 'a', target: 'b', kind: 'link', similarity: 99 },
    ];

    it('only returns visible semantic suggestions above the selected threshold', () => {
        expect(getVisibleSimilarityEdges(edges, new Set(['a', 'b']), 80)).toEqual([edges[0]]);
    });

    it('keeps the semantic layer hidden at 100%', () => {
        expect(getVisibleSimilarityEdges(edges, new Set(['a', 'b', 'c']), 100)).toEqual([]);
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
