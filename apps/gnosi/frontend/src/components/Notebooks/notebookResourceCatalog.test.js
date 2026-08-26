import { describe, expect, it } from 'vitest';

import {
    normalizeResourceFacets,
    notebookResourceCatalogUrl,
} from './notebookResourceCatalog';

describe('notebook Resource catalog', () => {
    it('builds one encoded query for search, paging, notebook exclusion, and facets', () => {
        const url = notebookResourceCatalogUrl({
            notebookId: 'notebook/1',
            query: 'ètica aplicada',
            page: 3,
            pageSize: 25,
            filters: {
                type: 'Article acadèmic',
                author: 'Ada Lovelace',
                tag: 'Ètica',
            },
        });
        const parsed = new URL(url, 'https://gnosi.local');

        expect(parsed.pathname).toBe('/api/notebooks/resources');
        expect(Object.fromEntries(parsed.searchParams)).toEqual({
            q: 'ètica aplicada',
            page: '3',
            page_size: '25',
            notebook_id: 'notebook/1',
            type: 'Article acadèmic',
            author: 'Ada Lovelace',
            tag: 'Ètica',
        });
    });

    it('normalizes an older response without facets', () => {
        expect(normalizeResourceFacets()).toEqual({ types: [], authors: [], tags: [] });
    });
});
