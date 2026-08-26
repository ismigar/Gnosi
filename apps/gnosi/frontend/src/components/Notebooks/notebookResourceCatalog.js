export const EMPTY_RESOURCE_FILTERS = Object.freeze({
    type: '',
    author: '',
    tag: '',
});

export const EMPTY_RESOURCE_FACETS = Object.freeze({
    types: Object.freeze([]),
    authors: Object.freeze([]),
    tags: Object.freeze([]),
});

export function notebookResourceCatalogUrl({
    notebookId = '',
    query = '',
    page = 1,
    pageSize = 50,
    filters = EMPTY_RESOURCE_FILTERS,
} = {}) {
    const params = new URLSearchParams({
        q: String(query || ''),
        page: String(page),
        page_size: String(pageSize),
    });
    if (notebookId) params.set('notebook_id', String(notebookId));
    for (const key of ['type', 'author', 'tag']) {
        const value = String(filters[key] || '').trim();
        if (value) params.set(key, value);
    }
    return `/api/notebooks/resources?${params.toString()}`;
}

export function normalizeResourceFacets(facets) {
    return {
        types: Array.isArray(facets?.types) ? facets.types : [],
        authors: Array.isArray(facets?.authors) ? facets.authors : [],
        tags: Array.isArray(facets?.tags) ? facets.tags : [],
    };
}
