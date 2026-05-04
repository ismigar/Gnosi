import { matchesFilters, matchesSearch as vaultMatchesSearch } from './vaultFilters';

export { matchesFilters, vaultMatchesSearch };

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
        // New visibility and field filters
        visibleDatabases = [],
        visibleTables = [],
        activeTableFilters = new Set(),
        fieldFilters = {},
        // Vault integration
        isVaultMode = false,
        vaultFilters = [],
        activeTableId = null,
        activeMediaTags = new Set()
    } = filters;

    const visibleNodes = new Set();
    const visibleEdges = new Set();

    // Preparation for new filters
    const hasDbVisibility = visibleDatabases.length > 0;
    const hasTableVisibility = visibleTables.length > 0;
    const visibleDbSet = new Set(visibleDatabases);
    const visibleTableSet = new Set(visibleTables);
    const hasFieldFilters = Object.keys(fieldFilters).some(k => fieldFilters[k] && fieldFilters[k].size > 0);

    if (selectedNode) {
        // Depth mode logic (Pathfinding/Context)
        const maxDepth = Number(depth);
        const queue = [{ node: selectedNode, d: 0 }];
        visibleNodes.add(selectedNode);

        while (queue.length > 0) {
            const { node, d } = queue.shift();

            if (d >= maxDepth) continue;

            try {
                const neighbors = graph.neighbors(node);
                neighbors.forEach((neighbor) => {
                    if (!visibleNodes.has(neighbor)) {
                        const nextDepth = d + 1;
                        if (nextDepth <= maxDepth) {
                            visibleNodes.add(neighbor);
                            queue.push({ node: neighbor, d: nextDepth });
                        }
                    }
                });
            } catch (err) {
                // Ignore if node not found
            }
        }

        graph.forEachEdge((edge, attrs, source, target) => {
            if (visibleNodes.has(source) && visibleNodes.has(target)) {
                visibleEdges.add(edge);
            }
        });

    } else {
        // Normal filter mode
        const clusterFiltersLower = new Set(Array.from(activeClusters).map(c => c.toLowerCase()));
        const kindFiltersLower = new Set(Array.from(activeKinds).map(k => k.toLowerCase()));
        const projectFiltersLower = new Set(Array.from(activeProjects).map(p => p.toLowerCase()));

        graph.forEachNode((node, attrs) => {
            // 🔍 Categorization logic
            const nodeDb = attrs.database_id;
            const nodeTable = attrs.table_id || attrs.database_table_id;
            // A node is only considered a Wiki node if explicitly marked as such OR lacks DB/Table info
            const isWikiNode = attrs.kind === 'Wiki' || (!nodeDb && (!nodeTable || nodeTable === '__wiki__'));

            // ──────── ESTAT DEL VAULT (NOU) ────────
            if (isVaultMode) {
                // En mode Vault, primer filtrem per la taula activa
                if (activeTableId && activeTableId !== 'wiki') {
                    if (nodeTable !== activeTableId) return;
                } else if (activeTableId === 'wiki') {
                    if (!isWikiNode) return;
                }

                // Després apliquem els filtres de la vista i la cerca
                if (!vaultMatchesSearch(attrs, searchTerm)) return;
                if (!matchesFilters(attrs, vaultFilters)) return;
                
                // Si passa, és visible
                visibleNodes.add(node);
                return;
            }

            // ──────── FILTRES ESTÀNDARD DEL GRAF ────────

            // 1. Database & Table Visibility (Global Settings)
            if (!isWikiNode) {
                if (hasDbVisibility && (!nodeDb || !visibleDbSet.has(nodeDb))) {
                    return;
                }
                if (hasTableVisibility && (!nodeTable || !visibleTableSet.has(nodeTable))) {
                    return;
                }
            }

            // 2. Table Sidebar Filters (Strict Whitelist)
            if (filters.activeTableFilters && filters.activeTableFilters.size > 0) {
                if (isWikiNode) {
                    if (!filters.activeTableFilters.has('__wiki__')) {
                        // console.debug(`[Filter] Hiding Wiki node: ${attrs.label}`);
                        return;
                    }
                } else {
                    if (!filters.activeTableFilters.has(nodeTable)) {
                        // console.debug(`[Filter] Hiding Record node: ${attrs.label} (Table: ${nodeTable})`);
                        return;
                    }
                }
            }


            // 3. Field Value Filters
            if (hasFieldFilters) {
                let matchFields = true;
                for (const [fieldKey, activeValues] of Object.entries(fieldFilters)) {
                    if (!activeValues || activeValues.size === 0) continue;
                    
                    const [tableId, fieldName] = fieldKey.split(':');
                    if (nodeTable === tableId) {
                        const val = attrs[fieldName] || attrs.metadata?.[fieldName];
                        if (!activeValues.has(val)) {
                            matchFields = false;
                            break;
                        }
                    }
                }
                if (!matchFields) return;
            }

            let matchCluster = true;
            if (clusterFiltersLower.size > 0) {
                const allTagsLower = [
                    (attrs.cluster || "").toLowerCase(),
                    ...((attrs.clusters_extra || []).map(t => (t || "").toLowerCase()))
                ].filter(Boolean);
                matchCluster = allTagsLower.some(t => clusterFiltersLower.has(t));
            }

            const nodeKind = (attrs.kind || "").toLowerCase();
            const matchKind = kindFiltersLower.size === 0 || kindFiltersLower.has(nodeKind);

            const nodeProject = (attrs.project || "").toLowerCase();
            const matchProject = projectFiltersLower.size === 0 || projectFiltersLower.has(nodeProject);

            // 4. Media specific tag filter (New)
            let matchMediaTags = true;
            if (nodeKind === 'media' && activeMediaTags && activeMediaTags.size > 0) {
                const nodeTags = attrs.tags || attrs.metadata?.tags || [];
                matchMediaTags = nodeTags.some(tag => activeMediaTags.has(tag));
            }

            const isIsolated = graph.degree(node) === 0;
            let isNodeVisible;

            if (onlyIsolated) {
                isNodeVisible = isIsolated &&
                    (clusterFiltersLower.size === 0 || matchCluster) &&
                    (kindFiltersLower.size === 0 || matchKind) &&
                    (projectFiltersLower.size === 0 || matchProject);
            } else {
                const matchIsolated = !hideIsolated || !isIsolated;

                // Search Term Filter
                let matchSearch = true;
                if (searchTerm && searchTerm.trim() !== "") {
                    const term = searchTerm.toLowerCase().trim();
                    const label = (attrs.label || "").toLowerCase();
                    matchSearch = label.includes(term);
                }

                // Timeline Filter
                let matchTimeline = true;
                if (timelineDate && attrs.created_time) {
                    const nodeTime = new Date(attrs.created_time).getTime();
                    if (nodeTime > timelineDate) {
                        matchTimeline = false;
                    }
                }

                isNodeVisible = matchCluster && matchKind && matchProject && matchIsolated && matchSearch && matchTimeline && matchMediaTags;
            }

            if (isNodeVisible) {
                visibleNodes.add(node);
            }
        });

        // Edge filtering
        graph.forEachEdge((edge, attrs, source, target) => {
            const sourceHidden = !visibleNodes.has(source);
            const targetHidden = !visibleNodes.has(target);

            const isReal = attrs.kind === 'explicit' || attrs.kind === 'structural' || attrs.kind === 'wikilink';
            const sim = attrs.similarity !== undefined ? Number(attrs.similarity) : 0;
            const filterSim = Number(similarity);

            let isEdgeVisible = !sourceHidden && !targetHidden;

            if (isEdgeVisible) {
                if (isReal) {
                    isEdgeVisible = true;
                } else if (filterSim >= 100) {
                    isEdgeVisible = false;
                } else {
                    isEdgeVisible = sim >= filterSim;
                }
            }

            if (isEdgeVisible) {
                visibleEdges.add(edge);
            }
        });
    }

    return { visibleNodes, visibleEdges };
}


