import { describe, expect, it } from 'vitest';
import Graph from 'graphology';
import { getVisibleConnectionGroups } from './graphConnections';

function buildGraph(): Graph {
    const graph = new Graph();
    graph.addNode('a', { kind: 'page', label: 'Alpha' });
    graph.addNode('b', { kind: 'page', label: 'Beta' });
    graph.addNode('c', { kind: 'page', label: 'Gamma' });
    graph.addDirectedEdge('a', 'b', {
        kind: 'link',
        directed: true,
        similarity: null,
    });
    return graph;
}

describe('visible connection groups', () => {
    const proposals = [{
        source: 'b',
        target: 'c',
        kind: 'suggestion',
        reason: 'Shared concern',
        suggestion_id: 'proposal-1',
    }];

    it('uses legend types and never turns a null score into zero percent', () => {
        const groups = getVisibleConnectionGroups(
            buildGraph(),
            { showSemanticSuggestions: true },
            proposals,
        );
        const structuralEdgeId = groups.at(0)?.targets.at(0)?.id;
        expect(typeof structuralEdgeId).toBe('string');

        expect(groups).toEqual([
            {
                id: 'a',
                label: 'Alpha',
                url: undefined,
                targets: [{
                    id: structuralEdgeId,
                    label: 'Beta',
                    url: undefined,
                    type: 'wikilink',
                    directed: true,
                    reason: '',
                }],
            },
            {
                id: 'b',
                label: 'Beta',
                url: undefined,
                targets: [{
                    id: 'semantic:proposal-1:b:c',
                    label: 'Gamma',
                    url: undefined,
                    type: 'semantic_similarity',
                    directed: false,
                    reason: 'Shared concern',
                }],
            },
        ]);
    });

    it('omits Brain proposals when the semantic layer is disabled', () => {
        const groups = getVisibleConnectionGroups(
            buildGraph(),
            { showSemanticSuggestions: false },
            proposals,
        );

        expect(groups).toHaveLength(1);
        expect(groups.at(0)?.targets.at(0)?.type).toBe('wikilink');
    });
});
