type ResourceCatalogScalar = string | number | boolean | null | undefined;

interface ResourceFilters {
    author?: ResourceCatalogScalar;
    tag?: ResourceCatalogScalar;
    type?: ResourceCatalogScalar;
}

interface ResourceCatalogUrlOptions {
    filters?: ResourceFilters;
    notebookId?: ResourceCatalogScalar;
    page?: number;
    pageSize?: number;
    query?: ResourceCatalogScalar;
}

interface ResourceFacetsInput {
    authors?: unknown;
    tags?: unknown;
    types?: unknown;
}

interface NormalizedResourceFacets {
    authors: readonly unknown[];
    tags: readonly unknown[];
    types: readonly unknown[];
}

const RESOURCE_FILTER_KEYS = ['type', 'author', 'tag'] as const;

function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

export const EMPTY_RESOURCE_FILTERS: Readonly<Required<ResourceFilters>> = Object.freeze({
    type: '',
    author: '',
    tag: '',
});

export const EMPTY_RESOURCE_FACETS: NormalizedResourceFacets = Object.freeze({
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
}: ResourceCatalogUrlOptions = {}): string {
    const params = new URLSearchParams({
        q: String(query || ''),
        page: String(page),
        page_size: String(pageSize),
    });
    if (notebookId) params.set('notebook_id', String(notebookId));
    for (const key of RESOURCE_FILTER_KEYS) {
        const value = String(filters[key] || '').trim();
        if (value) params.set(key, value);
    }
    return `/api/notebooks/resources?${params.toString()}`;
}

export function normalizeResourceFacets(
    facets?: ResourceFacetsInput | null,
): NormalizedResourceFacets {
    return {
        types: isUnknownArray(facets?.types) ? facets.types : [],
        authors: isUnknownArray(facets?.authors) ? facets.authors : [],
        tags: isUnknownArray(facets?.tags) ? facets.tags : [],
    };
}
