import { describe, expect, it } from 'vitest';
import { getConnectionTypeCounts } from './graphLegend';

describe('getConnectionTypeCounts', () => {
    it('separates visible Markdown, database-view, and unresolved links', () => {
        expect(getConnectionTypeCounts([
            { kind: 'link' },
            { kind: 'relation', body_link: true },
            { kind: 'link', unresolved: true },
            { kind: 'relation', body_link: true },
            { kind: 'suggestion' },
        ])).toEqual({
            wikilink: 1,
            database_wikilink: 2,
            unresolved: 1,
            semantic_similarity: 1,
        });
    });
});
