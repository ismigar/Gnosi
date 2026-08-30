import type Graph from 'graphology';

import {
    matchesFilters,
    matchesSearch as vaultMatchesSearch,
    type FilterItem,
    type FilterNode,
} from './vaultFilters';

interface GraphMetadata extends Readonly<Record<string, unknown>> {
    account_id?: string | null;
    calendar_id?: string | null;
    database_id?: string | null;
    database_table_id?: string | null;
    source?: string | null;
    table_id?: string | null;
    tags?: readonly string[];
}

interface GraphNodeAttributes extends FilterItem {
    cluster?: string | null;
    clusters_extra?: readonly (string | null | undefined)[];
    created_time?: string | number | null;
    database_id?: string | null;
    database_table_id?: string | null;
    kind?: string | null;
    label?: string | null;
    metadata?: GraphMetadata;
    path?: string | null;
    project?: string | null;
    table_id?: string | null;
    tags?: readonly string[];
}

export interface GraphEdgeAttributes {
    [key: string]: unknown;
    hidden?: unknown;
    kind?: string | null;
}

interface GraphFilterOptions {
    activeClusters?: ReadonlySet<string>;
    activeKinds?: ReadonlySet<string>;
    activeMediaTags?: ReadonlySet<string> | null;
    activeProjects?: ReadonlySet<string>;
    activeTableFilters?: ReadonlySet<string>;
    activeTableId?: string | null;
    depth?: number | string;
    fieldFilters?: Readonly<Record<
        string,
        ReadonlySet<string> | null | undefined
    >>;
    graphTableFiltersSettings?: readonly string[] | null;
    hideIsolated?: boolean;
    isVaultMode?: boolean;
    onlyIsolated?: boolean;
    searchTerm?: string | null;
    selectedNode?: string | null;
    sourcesInitialized?: boolean;
    timelineDate?: number | null;
    vaultFilters?: readonly FilterNode[];
    visibleDatabases?: readonly string[];
    visibleTables?: readonly string[];
}

interface GraphFilterResult {
    visibleEdges: Set<string>;
    visibleNodes: Set<string>;
}

interface GraphNeighborhood {
    edges: Set<string>;
    nodes: Set<string>;
}

export type FilterGraph = Pick<Graph<GraphNodeAttributes, GraphEdgeAttributes>,
    'forEachNode' | 'forEachEdge' | 'getNodeAttribute' | 'neighbors' | 'source' | 'target'>;

type SystemCategory =
    | 'assets'
    | 'calendar'
    | 'contacts'
    | 'drawings'
    | 'images'
    | 'mail'
    | 'wiki';

function stringifyGraphValue(value: unknown): string {
    return Reflect.apply(String, undefined, [value]);
}

function isFilterValueArray(
    value: unknown,
): value is readonly unknown[] {
    return Array.isArray(value);
}

export { matchesFilters, vaultMatchesSearch };

// Folds accents for accent-insensitive search ("historia" finds
// "Història"), as expected in a Catalan/Castilian vault. NFD decomposes
// accented letters and combining marks are removed (U+0300–U+036F:
// accents, cedilla, titlla).
const foldAccents = (value: unknown): string =>
    stringifyGraphValue(value ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');

/**
 * Determines the logical table/category ID for a node, unifying registry nodes,
 * system entities (calendar, contacts…) and standard BD pages.
 */
export function getEffectiveTableId(
    attrs: GraphNodeAttributes,
): string | null {
    const nodeDb = attrs.database_id || attrs.metadata?.database_id;
    const nodeTableRaw = attrs.table_id || attrs.database_table_id
        || attrs.metadata?.table_id || attrs.metadata?.database_table_id;
    const nodeKind = (attrs.kind || "").toLowerCase();
    const nodePath = attrs.path || "";

    // SYSTEM ENTITIES are classified FIRST (by kind/path). A node of
    // contact/calendar/mail/drawing does NOT have a database_id or table_id, so the
    // "wiki" check (no db/table) was swallowing them and they ended up
    // misclassified as 'wiki' (e.g. the 200 contacts in the graph). The wiki is
    // the LAST resort.
    if (nodeKind === 'calendar' || nodePath.startsWith('Calendar/')) {
        return attrs.metadata?.calendar_id
            ? `calendar:${attrs.metadata.calendar_id}`
            : (attrs.metadata?.source || 'calendar:local');
    }
    if (nodeKind === 'contact' || nodePath.startsWith('Contacts/') || nodePath.startsWith('Contactes/')) {
        return attrs.metadata?.account_id
            ? `contact:${attrs.metadata.account_id}`
            : (attrs.metadata?.source || 'contact:local');
    }
    if (nodeKind === 'mail') {
        return attrs.metadata?.account_id ? `mail:${attrs.metadata.account_id}` : 'mail:unknown';
    }
    if (nodeKind === 'drawing' || nodePath.startsWith('Drawings/') || nodePath.startsWith('Dibuixos/')) return 'drawings';
    if (nodeKind === 'image' || nodeKind === 'media' || nodePath.startsWith('Assets/Images/') || nodePath.startsWith('Imatges/')) return 'images';
    if (nodeKind === 'asset' || nodeKind === 'adjunt') return 'assets';

    const isWikiNode = attrs.kind === 'Wiki' || (!nodeDb && (!nodeTableRaw || nodeTableRaw === '__wiki__'));
    if (isWikiNode) return 'wiki';

    return nodeTableRaw || null;
}

/** Returns the system category for a node (wiki/calendar/contacts/mail/drawings/images/assets), or null for BD pages. */
export function getSystemCategory(
    attrs: GraphNodeAttributes,
): SystemCategory | null {
    const nodeDb = attrs.database_id || attrs.metadata?.database_id;
    const nodeTableRaw = attrs.table_id || attrs.database_table_id
        || attrs.metadata?.table_id || attrs.metadata?.database_table_id;
    const nodeKind = (attrs.kind || "").toLowerCase();
    const nodePath = attrs.path || "";

    // System FIRST (by kind/path); the wiki (no db/table) is the last resort,
    // otherwise it would swallow the system nodes (contact/calendar/mail…).
    if (nodeKind === 'calendar' || nodePath.startsWith('Calendar/')) return 'calendar';
    if (nodeKind === 'contact' || nodePath.startsWith('Contacts/') || nodePath.startsWith('Contactes/')) return 'contacts';
    if (nodeKind === 'mail') return 'mail';
    if (nodeKind === 'drawing' || nodePath.startsWith('Drawings/') || nodePath.startsWith('Dibuixos/')) return 'drawings';
    if (nodeKind === 'image' || nodeKind === 'media' || nodePath.startsWith('Assets/Images/') || nodePath.startsWith('Imatges/')) return 'images';
    if (nodeKind === 'asset' || nodeKind === 'adjunt') return 'assets';
    const isWikiNode = attrs.kind === 'Wiki' || (!nodeDb && (!nodeTableRaw || nodeTableRaw === '__wiki__'));
    if (isWikiNode) return 'wiki';
    return null;
}

/**
 * Looks up a field value from node attrs using case-insensitive metadata key matching.
 * Needed because the schema may use 'Tags' while frontmatter YAML uses 'tags'.
 */
export function resolveMetaValue(
    attrs: GraphNodeAttributes,
    fieldName: string,
): unknown {
    if (attrs[fieldName] !== undefined) return attrs[fieldName];
    const meta = attrs.metadata || {};
    const lower = fieldName.toLowerCase();
    const key = Object.keys(meta).find(k => k.toLowerCase() === lower);
    return key !== undefined ? meta[key] : undefined;
}

/** Normalises a raw field value (scalar or array) to an array of non-empty strings. */
export function toValueStrings(raw: unknown): string[] {
    if (raw === undefined || raw === null || raw === "") return [];
    const values = isFilterValueArray(raw) ? raw : [raw];
    return values
        .filter((value) => value !== undefined && value !== null && value !== '')
        .map(stringifyGraphValue);
}

/**
 * Returns only the visible one-hop neighborhood used by Sigma hover styling.
 * Hidden nodes and edges belong to the backing graph, but not to the topology
 * currently shown to the user.
 */
export function getVisibleHoverNeighborhood(
    graph: FilterGraph,
    node: string,
): GraphNeighborhood {
    const nodes = new Set<string>([node]);
    const edges = new Set<string>();

    graph.forEachEdge((edge, attrs, source, target) => {
        if (attrs.kind === 'suggestion') return;
        if (attrs.hidden || (source !== node && target !== node)) return;
        const neighbor = source === node ? target : source;
        if (graph.getNodeAttribute(neighbor, 'hidden')) return;
        edges.add(edge);
        nodes.add(neighbor);
    });

    return { nodes, edges };
}

export function applyFilters(
    graph: FilterGraph,
    filters: GraphFilterOptions,
): GraphFilterResult {
    const {
        activeClusters = new Set<string>(),
        activeKinds = new Set<string>(),
        activeProjects = new Set<string>(),
        hideIsolated = false,
        onlyIsolated = false,
        selectedNode = null,
        depth = 1,
        searchTerm = "",
        timelineDate = null,
        visibleDatabases = [],
        visibleTables = [],
        sourcesInitialized = false,
        activeTableFilters = new Set<string>(),
        fieldFilters = {},
        isVaultMode = false,
        vaultFilters = [],
        activeTableId = null,
        activeMediaTags = new Set<string>()
    } = filters;

    const visibleNodes = new Set<string>();
    const visibleEdges = new Set<string>();

    const hasDbVisibility = visibleDatabases.length > 0;
    const hasTableVisibility = visibleTables.length > 0;
    const visibleDbSet = new Set(visibleDatabases);
    const visibleTableSet = new Set(visibleTables);
    const hasFieldFilters = Object.keys(fieldFilters).some(k => fieldFilters[k] && fieldFilters[k].size > 0);

    if (selectedNode) {
        const maxDepth = Number(depth);
        const queue: Array<{ d: number; node: string }> = [
            { node: selectedNode, d: 0 },
        ];
        visibleNodes.add(selectedNode);

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) break;
            const { node, d } = current;
            if (d >= maxDepth) continue;
            try {
                graph.neighbors(node).forEach((neighbor) => {
                    if (!visibleNodes.has(neighbor) && d + 1 <= maxDepth) {
                        visibleNodes.add(neighbor);
                        queue.push({ node: neighbor, d: d + 1 });
                    }
                });
            } catch { /* node not found */ }
        }

        graph.forEachEdge((edge, attrs, source, target) => {
            const isSemantic = attrs.kind === 'suggestion';
            if (!isSemantic && visibleNodes.has(source) && visibleNodes.has(target)) visibleEdges.add(edge);
        });

    } else {
        const clusterFiltersLower = new Set(Array.from(activeClusters).map(c => c.toLowerCase()));
        const kindFiltersLower = new Set(Array.from(activeKinds).map(k => k.toLowerCase()));
        const projectFiltersLower = new Set(Array.from(activeProjects).map(p => p.toLowerCase()));

        graph.forEachNode((node, attrs) => {
            const nodeKind = (attrs.kind || "").toLowerCase();

            // Registry structure nodes are never content
            if (nodeKind === 'table' || nodeKind === 'database' || nodeKind === 'view') return;
            // Genuinely unresolved targets are evaluated after their source
            // notes and shown only when a visible note references them.
            if (nodeKind === 'unresolved') return;

            const nodeDb = attrs.database_id || attrs.metadata?.database_id;
            const nodeTableRaw = attrs.table_id || attrs.database_table_id
                || attrs.metadata?.table_id || attrs.metadata?.database_table_id;
            const isWikiNode = attrs.kind === 'Wiki' || (!nodeDb && (!nodeTableRaw || nodeTableRaw === '__wiki__'));

            const systemCategory = getSystemCategory(attrs);
            const effectiveTableId = getEffectiveTableId(attrs);

            // Vault mode
            if (isVaultMode) {
                if (activeTableId && activeTableId !== 'wiki') {
                    if (nodeTableRaw !== activeTableId) return;
                } else if (activeTableId === 'wiki') {
                    if (!isWikiNode) return;
                }
                if (!vaultMatchesSearch(attrs, searchTerm)) return;
                if (!matchesFilters(attrs, vaultFilters)) return;
                visibleNodes.add(node);
                return;
            }

            // 1. Database/Table visibility from global settings
            // Convention: once the user has initialized their sources
            // (`sourcesInitialized`, seeded on first load), an empty selection
            // EMPTY means "don't show anything". Before initializing we keep the
            // inherited behavior ("empty = show everything") so as not to leave the graph
            // blank during loading/migration.
            const enforceSources = sourcesInitialized;
            if (systemCategory) {
                const isBucketOnly = ['wiki', 'drawings', 'images', 'assets'].includes(systemCategory);
                if (enforceSources || hasDbVisibility) {
                    if (!visibleDbSet.has(systemCategory)) return;
                }
                // wiki/drawings/images/assets have no sub-element: they are only filtered by category.
                if (!isBucketOnly && (enforceSources || hasTableVisibility)) {
                    if (effectiveTableId === null
                        || !visibleTableSet.has(effectiveTableId)) return;
                }
            } else {
                if (nodeTableRaw) {
                    if (enforceSources) {
                        // Visible if the table is selected OR its parent DB is.
                        if (!visibleTableSet.has(nodeTableRaw) && !(nodeDb && visibleDbSet.has(nodeDb))) return;
                    } else {
                        if (hasTableVisibility && !visibleTableSet.has(nodeTableRaw)) return;
                        if (hasDbVisibility && nodeDb && !visibleDbSet.has(nodeDb)) return;
                    }
                } else {
                    if (enforceSources) {
                        if (!nodeDb || !visibleDbSet.has(nodeDb)) return;
                    } else {
                        if (hasDbVisibility && (!nodeDb || !visibleDbSet.has(nodeDb))) return;
                    }
                }
            }

            // 2. Table sidebar toggles
            if (activeTableFilters.size > 0) {
                if (isWikiNode) {
                    if (!activeTableFilters.has('__wiki__')) return;
                } else {
                    const configuredTables = filters.graphTableFiltersSettings || [];
                    const isManaged = nodeTableRaw !== null
                        && nodeTableRaw !== undefined
                        ? configuredTables.includes(nodeTableRaw)
                        : false;
                    if (
                        isManaged
                        && nodeTableRaw !== null
                        && nodeTableRaw !== undefined
                        && !activeTableFilters.has(nodeTableRaw)
                    ) return;
                }
            }

            // 3. Field value filters
            if (hasFieldFilters) {
                for (const [fieldKey, activeValues] of Object.entries(fieldFilters)) {
                    if (!activeValues || activeValues.size === 0) continue;
                    const [tableId, fieldName = ''] = fieldKey.split(':');
                    if (effectiveTableId !== tableId) continue;
                    const nodeVals = toValueStrings(resolveMetaValue(attrs, fieldName));
                    if (!nodeVals.some(v => activeValues.has(v))) return;
                }
            }

            let matchCluster = true;
            if (clusterFiltersLower.size > 0) {
                const allTagsLower = [
                    (attrs.cluster || "").toLowerCase(),
                    ...((attrs.clusters_extra || []).map(t => (t || "").toLowerCase()))
                ].filter(Boolean);
                matchCluster = allTagsLower.some(t => clusterFiltersLower.has(t));
            }

            const matchKind = kindFiltersLower.size === 0 || kindFiltersLower.has(nodeKind);
            const matchProject = projectFiltersLower.size === 0 || projectFiltersLower.has((attrs.project || "").toLowerCase());

            let matchMediaTags = true;
            if (nodeKind === 'media' && activeMediaTags && activeMediaTags.size > 0) {
                const nodeTags = attrs.tags || attrs.metadata?.tags || [];
                matchMediaTags = nodeTags.some(tag => activeMediaTags.has(tag));
            }

            const matchSearch = !searchTerm?.trim()
                || foldAccents(attrs.label).includes(foldAccents(searchTerm).trim());
            const matchTimeline = !timelineDate || !attrs.created_time
                || new Date(attrs.created_time).getTime() <= timelineDate;
            const isNodeVisible = matchCluster && matchKind && matchProject
                && matchSearch && matchTimeline && matchMediaTags;

            if (isNodeVisible) visibleNodes.add(node);
        });

        graph.forEachNode((node, attrs) => {
            if ((attrs.kind || "").toLowerCase() !== 'unresolved') return;
            const hasVisibleSource = graph.neighbors(node)
                .some(neighbor => visibleNodes.has(neighbor));
            if (hasVisibleSource) visibleNodes.add(node);
        });

        graph.forEachEdge((edge, attrs, source, target) => {
            if (!visibleNodes.has(source) || !visibleNodes.has(target)) return;

            // Semantic proposals are drawn by a separate canvas overlay. They
            // never belong to structural topology, even if a caller supplied
            // them in the backing graph.
            if (attrs.kind === 'suggestion') return;

            // 'link' = wikilinks [[...]], 'relation' = frontmatter relations (by schema)
            const isReal = attrs.kind === 'explicit' || attrs.kind === 'structural'
                || attrs.kind === 'wikilink' || attrs.kind === 'link' || attrs.kind === 'relation';
            if (isReal) visibleEdges.add(edge);
        });

        // Isolation is a property of the rendered topology, not the backing
        // graph. An edge excluded by source, table, or visibility filters must
        // not make either endpoint count as connected.
        // “Show only” wins defensively if stale state supplies both mutually
        // exclusive modes at once.
        const effectiveHideIsolated = hideIsolated && !onlyIsolated;
        if (effectiveHideIsolated || onlyIsolated) {
            const connectedNodes = new Set<string>();
            visibleEdges.forEach((edge) => {
                connectedNodes.add(graph.source(edge));
                connectedNodes.add(graph.target(edge));
            });
            visibleNodes.forEach((node) => {
                const isVisiblyIsolated = !connectedNodes.has(node);
                if ((effectiveHideIsolated && isVisiblyIsolated) || (onlyIsolated && !isVisiblyIsolated)) {
                    visibleNodes.delete(node);
                }
            });
            visibleEdges.forEach((edge) => {
                if (!visibleNodes.has(graph.source(edge)) || !visibleNodes.has(graph.target(edge))) {
                    visibleEdges.delete(edge);
                }
            });
        }
    }

    return { visibleNodes, visibleEdges };
}
