import { matchesFilters, matchesSearch as vaultMatchesSearch } from './vaultFilters';

export { matchesFilters, vaultMatchesSearch };

/**
 * Determines the logical table/category ID for a node, unifying registry nodes,
 * system entities (calendar, contacts…) and standard BD pages.
 */
export function getEffectiveTableId(attrs) {
    const nodeDb = attrs.database_id || attrs.metadata?.database_id;
    const nodeTableRaw = attrs.table_id || attrs.database_table_id
        || attrs.metadata?.table_id || attrs.metadata?.database_table_id;
    const nodeKind = (attrs.kind || "").toLowerCase();
    const nodePath = attrs.path || "";

    const isWikiNode = attrs.kind === 'Wiki' || (!nodeDb && (!nodeTableRaw || nodeTableRaw === '__wiki__'));
    if (isWikiNode) return 'wiki';

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

    return nodeTableRaw || null;
}

/** Returns the system category for a node (wiki/calendar/contacts/mail/drawings/images/assets), or null for BD pages. */
export function getSystemCategory(attrs) {
    const nodeDb = attrs.database_id || attrs.metadata?.database_id;
    const nodeTableRaw = attrs.table_id || attrs.database_table_id
        || attrs.metadata?.table_id || attrs.metadata?.database_table_id;
    const nodeKind = (attrs.kind || "").toLowerCase();
    const nodePath = attrs.path || "";

    const isWikiNode = attrs.kind === 'Wiki' || (!nodeDb && (!nodeTableRaw || nodeTableRaw === '__wiki__'));
    if (isWikiNode) return 'wiki';
    if (nodeKind === 'calendar' || nodePath.startsWith('Calendar/')) return 'calendar';
    if (nodeKind === 'contact' || nodePath.startsWith('Contacts/') || nodePath.startsWith('Contactes/')) return 'contacts';
    if (nodeKind === 'mail') return 'mail';
    if (nodeKind === 'drawing' || nodePath.startsWith('Drawings/') || nodePath.startsWith('Dibuixos/')) return 'drawings';
    if (nodeKind === 'image' || nodeKind === 'media' || nodePath.startsWith('Assets/Images/') || nodePath.startsWith('Imatges/')) return 'images';
    if (nodeKind === 'asset' || nodeKind === 'adjunt') return 'assets';
    return null;
}

/**
 * Looks up a field value from node attrs using case-insensitive metadata key matching.
 * Needed because the schema may use 'Tags' while frontmatter YAML uses 'tags'.
 */
export function resolveMetaValue(attrs, fieldName) {
    if (attrs[fieldName] !== undefined) return attrs[fieldName];
    const meta = attrs.metadata || {};
    const lower = fieldName.toLowerCase();
    const key = Object.keys(meta).find(k => k.toLowerCase() === lower);
    return key !== undefined ? meta[key] : undefined;
}

/** Normalises a raw field value (scalar or array) to an array of non-empty strings. */
export function toValueStrings(raw) {
    if (raw === undefined || raw === null || raw === "") return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.filter(v => v !== undefined && v !== null && v !== "").map(String);
}

export function applyFilters(graph, filters) {
    const {
        activeClusters = new Set(),
        activeKinds = new Set(),
        activeProjects = new Set(),
        similarity = 0,
        hideIsolated = false,
        onlyIsolated = false,
        selectedNode = null,
        depth = 1,
        searchTerm = "",
        timelineDate = null,
        visibleDatabases = [],
        visibleTables = [],
        activeTableFilters = new Set(),
        fieldFilters = {},
        isVaultMode = false,
        vaultFilters = [],
        activeTableId = null,
        activeMediaTags = new Set()
    } = filters;

    const visibleNodes = new Set();
    const visibleEdges = new Set();

    const hasDbVisibility = visibleDatabases.length > 0;
    const hasTableVisibility = visibleTables.length > 0;
    const visibleDbSet = new Set(visibleDatabases);
    const visibleTableSet = new Set(visibleTables);
    const hasFieldFilters = Object.keys(fieldFilters).some(k => fieldFilters[k] && fieldFilters[k].size > 0);

    if (selectedNode) {
        const maxDepth = Number(depth);
        const queue = [{ node: selectedNode, d: 0 }];
        visibleNodes.add(selectedNode);

        while (queue.length > 0) {
            const { node, d } = queue.shift();
            if (d >= maxDepth) continue;
            try {
                graph.neighbors(node).forEach((neighbor) => {
                    if (!visibleNodes.has(neighbor) && d + 1 <= maxDepth) {
                        visibleNodes.add(neighbor);
                        queue.push({ node: neighbor, d: d + 1 });
                    }
                });
            } catch (_) { /* node not found */ }
        }

        graph.forEachEdge((edge, attrs, source, target) => {
            if (visibleNodes.has(source) && visibleNodes.has(target)) visibleEdges.add(edge);
        });

    } else {
        const clusterFiltersLower = new Set(Array.from(activeClusters).map(c => c.toLowerCase()));
        const kindFiltersLower = new Set(Array.from(activeKinds).map(k => k.toLowerCase()));
        const projectFiltersLower = new Set(Array.from(activeProjects).map(p => p.toLowerCase()));

        graph.forEachNode((node, attrs) => {
            const nodeKind = (attrs.kind || "").toLowerCase();

            // Registry structure nodes are never content
            if (nodeKind === 'table' || nodeKind === 'database' || nodeKind === 'view') return;

            const nodeDb = attrs.database_id || attrs.metadata?.database_id;
            const nodeTableRaw = attrs.table_id || attrs.database_table_id
                || attrs.metadata?.table_id || attrs.metadata?.database_table_id;
            const isWikiNode = attrs.kind === 'Wiki' || (!nodeDb && (!nodeTableRaw || nodeTableRaw === '__wiki__'));

            const systemCategory = getSystemCategory(attrs);
            const isSystemNode = !!systemCategory;
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
            if (isSystemNode) {
                if (hasDbVisibility && !visibleDbSet.has(systemCategory)) return;
                if (hasTableVisibility && !visibleTableSet.has(effectiveTableId)) {
                    if (!['wiki', 'drawings', 'images', 'assets'].includes(systemCategory)) return;
                }
            } else {
                if (nodeTableRaw) {
                    if (hasTableVisibility && !visibleTableSet.has(nodeTableRaw)) return;
                    if (hasDbVisibility && nodeDb && !visibleDbSet.has(nodeDb)) return;
                } else {
                    if (hasDbVisibility && (!nodeDb || !visibleDbSet.has(nodeDb))) return;
                }
            }

            // 2. Table sidebar toggles
            if (activeTableFilters.size > 0) {
                if (isWikiNode) {
                    if (!activeTableFilters.has('__wiki__')) return;
                } else {
                    const configuredTables = filters.graphTableFiltersSettings || [];
                    const isManaged = configuredTables.includes(nodeTableRaw);
                    if (isManaged && !activeTableFilters.has(nodeTableRaw)) return;
                }
            }

            // 3. Field value filters
            if (hasFieldFilters) {
                for (const [fieldKey, activeValues] of Object.entries(fieldFilters)) {
                    if (!activeValues || activeValues.size === 0) continue;
                    const [tableId, fieldName] = fieldKey.split(':');
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

            const isIsolated = graph.degree(node) === 0;
            let isNodeVisible;

            if (onlyIsolated) {
                isNodeVisible = isIsolated && matchCluster && matchKind && matchProject;
            } else {
                const matchIsolated = !hideIsolated || !isIsolated;
                const matchSearch = !searchTerm?.trim() || (attrs.label || "").toLowerCase().includes(searchTerm.toLowerCase().trim());
                const matchTimeline = !timelineDate || !attrs.created_time
                    || new Date(attrs.created_time).getTime() <= timelineDate;
                isNodeVisible = matchCluster && matchKind && matchProject && matchIsolated && matchSearch && matchTimeline && matchMediaTags;
            }

            if (isNodeVisible) visibleNodes.add(node);
        });

        graph.forEachEdge((edge, attrs, source, target) => {
            if (!visibleNodes.has(source) || !visibleNodes.has(target)) return;

            // 'link' = wikilinks [[...]], 'relation' = relacions del frontmatter (per esquema)
            const isReal = attrs.kind === 'explicit' || attrs.kind === 'structural'
                || attrs.kind === 'wikilink' || attrs.kind === 'link' || attrs.kind === 'relation';
            const sim = attrs.similarity !== undefined ? Number(attrs.similarity) : 0;
            const filterSim = Number(similarity);

            const visible = isReal || (filterSim < 100 && sim >= filterSim);
            if (visible) visibleEdges.add(edge);
        });
    }

    return { visibleNodes, visibleEdges };
}
