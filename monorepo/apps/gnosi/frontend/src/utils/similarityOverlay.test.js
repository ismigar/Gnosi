import { describe, expect, it } from 'vitest';
import { getVisibleSimilarityEdges } from './similarityOverlay';

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
});
