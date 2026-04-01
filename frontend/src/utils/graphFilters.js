
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
        fieldFilters = {}
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
        // Depth mode logic
        const maxDepth = Number(depth);
        const queue = [{ node: selectedNode, d: 0 }];
        visibleNodes.add(selectedNode);

        while (queue.length > 0) {
            const { node, d } = queue.shift();

            if (d >= maxDepth) continue;

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
            // 1. Database & Table Visibility (Global Settings)
            // Skip wiki nodes (no DB) — they are handled by __wiki__ in step 2
            const nodeDb = attrs.database_id;
            const nodeTable = attrs.table_id || attrs.database_table_id;
            const isWikiNode = !nodeDb && !nodeTable;

            if (!isWikiNode) {
                if (hasDbVisibility && (!nodeDb || !visibleDbSet.has(nodeDb))) {
                    return;
                }
                if (hasTableVisibility && (!nodeTable || !visibleTableSet.has(nodeTable))) {
                    return;
                }
            }

            // 2. Table Sidebar Filters
            // __wiki__ is a special sentinel for nodes that don't belong to any DB table
            if (activeTableFilters.size > 0 || (filters.graphTableFiltersSettings && filters.graphTableFiltersSettings.length > 0)) {
                const isWikiNode = !nodeTable;
                if (isWikiNode) {
                    // Wiki page: only show if __wiki__ toggle is active
                    if (!filters.activeTableFilters?.has('__wiki__')) {
                        return;
                    }
                } else if (nodeTable && filters.activeTableFilters && !filters.activeTableFilters.has(nodeTable)) {
                    // DB table node: check if this table is a configured filter and if it's unchecked
                    if (filters.graphTableFiltersSettings?.includes(nodeTable)) {
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

                isNodeVisible = matchCluster && matchKind && matchProject && matchIsolated && matchSearch && matchTimeline;
            }

            if (isNodeVisible) {
                visibleNodes.add(node);
            }
        });

        // Edge filtering
        graph.forEachEdge((edge, attrs, source, target) => {
            const sourceHidden = !visibleNodes.has(source);
            const targetHidden = !visibleNodes.has(target);

            const isReal = attrs.kind === 'explicit';
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

