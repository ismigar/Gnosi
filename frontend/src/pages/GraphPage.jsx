import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Check, AlertTriangle } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Sidebar } from '../components/Sidebar';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { VisualizationSection } from '../components/VisualizationSection';
import { ForcesSection } from '../components/ForcesSection';
import { GraphViewer } from '../components/GraphViewer';
import { Controls } from '../components/Controls';
import { Legend } from '../components/Legend';
import { Minimap } from '../components/Minimap';
import { ConnectionList } from '../components/ConnectionList';
import Graph from 'graphology';
import { applyFilters, getEffectiveTableId, getSystemCategory, resolveMetaValue, toValueStrings } from '../utils/graphFilters';
import { getConnectionTypeCounts } from '../utils/graphLegend';
import {
    getVisibleSemanticEdges,
    hasSemanticSuggestions,
} from '../utils/semanticOverlay';
import { useConfigChanged } from '../lib/configEvents';


import { NodeDetailsPanel } from '../components/NodeDetailsPanel';
import { GraphLoadingState } from '../components/GraphLoadingState';
import '../viewer/style.css';

const MINIMUM_LOADING_DURATION_MS = 900;

function GraphPage() {
    const { t } = useTranslation();
    const [graphData, setGraphData] = useState(null);
    const [graphInstance, setGraphInstance] = useState(null);
    const [rendererInstance, setRendererInstance] = useState(null);
    // The graph theme follows the app's `.dark` class (manual switch),
    // not the system's `prefers-color-scheme`, which ignored the toggle and left
    // the overlays (node count, legend, minimap…) light-colored in dark mode.
    const [isDarkMode, setIsDarkMode] = useState(() => document.documentElement.classList.contains('dark'));

    // Refine the cached backend layout with the active visible-subgraph forces.
    // The filter effect runs before the simulation, so hidden vault nodes never
    // compress the layout selected by the user.
    const isPhysicsEnabled = true;

    // Filter State
    const location = useLocation();
    const [searchTerm, setSearchTerm] = useState("");
    const [showSemanticSuggestions, setShowSemanticSuggestions] = useState(true);
    const [hideIsolated, setHideIsolated] = useState(false);
    const [onlyIsolated, setOnlyIsolated] = useState(false);
    const [activeClusters] = useState(new Set());
    const [activeKinds] = useState(new Set());
    const [activeProjects] = useState(new Set());
    const [colorMode, setColorMode] = useState('kind');
    const hasClusterData = useMemo(() => (graphData?.nodes || []).some((node) => node.cluster), [graphData]);

    // Visibility & Configuration (from config.graph)
    const [visibleDatabases, setVisibleDatabases] = useState([]);
    const [visibleTables, setVisibleTables] = useState([]);
    // Once the sources are seeded (1st load), an empty selection = "show nothing".
    const [sourcesInitialized, setSourcesInitialized] = useState(false);
    const [visibleFields, setVisibleFields] = useState([]); // Array of "tableId:fieldName"
    const [graphTableFiltersSettings, setGraphTableFiltersSettings] = useState([]); // Which tables HAVE a toggle
    const [activeTableFilters, setActiveTableFilters] = useState(new Set()); // Which table toggles are ON
    const [activeMediaTags, setActiveMediaTags] = useState(new Set()); // New: Tags specifically for media

    // Dynamic Field Filters
    // Map of "tableId:fieldName" -> Set of active values
    const [fieldFilters, setFieldFilters] = useState({});
    const [availableTables, setAvailableTables] = useState([]);
    // id→title map (all pages) to show the title of the pages
    // related to reference-type field filters, instead of the id.
    const [idTitleMap, setIdTitleMap] = useState({});

    // Visualization State
    const [showArrows, setShowArrows] = useState(true);
    const [labelThreshold, setLabelThreshold] = useState(14);
    const [nodeSize, setNodeSize] = useState(0.4);
    const [edgeThickness, setEdgeThickness] = useState(0.05);

    // Physics State - UI (Instant feedback for sliders)
    const [gravityUI, setGravityUI] = useState(0.1);
    const [repulsionUI, setRepulsionUI] = useState(1000);
    const [frictionUI, setFrictionUI] = useState(10);
    const [edgeInfluenceUI, setEdgeInfluenceUI] = useState(0);

    const [linLogMode, setLinLogMode] = useState(false);
    const [strongGravityMode, setStrongGravityMode] = useState(true);
    const [outboundAttractionDistribution, setOutboundAttractionDistribution] = useState(false);

    // Physics State - Real (Debounced for ForceAtlas2)
    // Initial values matching the UI's to avoid an abrupt restart at 300ms
    const [gravity, setGravity] = useState(0.1);
    const [repulsion, setRepulsion] = useState(1000);
    const [friction, setFriction] = useState(10);
    const [edgeInfluence, setEdgeInfluence] = useState(0);


    // Debounce Effects
    useEffect(() => {
        const timer = setTimeout(() => setGravity(gravityUI), 300);
        return () => clearTimeout(timer);
    }, [gravityUI]);

    useEffect(() => {
        const timer = setTimeout(() => setRepulsion(repulsionUI), 300);
        return () => clearTimeout(timer);
    }, [repulsionUI]);

    useEffect(() => {
        const timer = setTimeout(() => setFriction(frictionUI), 300);
        return () => clearTimeout(timer);
    }, [frictionUI]);

    useEffect(() => {
        const timer = setTimeout(() => setEdgeInfluence(edgeInfluenceUI), 300);
        return () => clearTimeout(timer);
    }, [edgeInfluenceUI]);



    // Selection State
    const [selectedNode, setSelectedNode] = useState(null);
    const [depth, setDepth] = useState(1);

    // Pathfinding State
    const [isPathfindingMode, setIsPathfindingMode] = useState(false);
    const [pathSource, setPathSource] = useState(null);
    const [pathTarget, setPathTarget] = useState(null);

    useEffect(() => {
        if (!isPathfindingMode) {
            setPathSource(null);
            setPathTarget(null);
        }
    }, [isPathfindingMode]);

    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadingProgress, setLoadingProgress] = useState(15);

    const mediaTagsList = useMemo(() => {
        if (!graphData?.nodes) return [];
        const tags = new Set();
        graphData.nodes.forEach(n => {
            if (n.kind === 'media' && n.metadata?.tags) {
                n.metadata.tags.forEach(t => tags.add(t));
            }
        });
        return Array.from(tags).sort();
    }, [graphData]);

    const fetchGraphData = (isBackground = false) => {
        const startedAt = Date.now();
        if (!isBackground) {
            setLoadingProgress(15);
            setLoading(true);
        }

        fetch('/api/graph').then(res => {
            if (!res.ok) throw new Error(`Graph API error: ${res.status}`);
            return res.json();
        }).then(graph => {
            // /api/graph is the single source for structural and proposal edges.
            if (!isBackground) setLoadingProgress(70);
            setGraphData(graph);
        })
            .catch(err => {
                console.error("Error loading graph data:", err);
                setGraphData({ nodes: [], edges: [], legend: { kinds: [], clusters: [] } });
            })
            .finally(() => {
                if (isBackground) return;
                setLoadingProgress(100);
                const remainingDelay = Math.max(0, MINIMUM_LOADING_DURATION_MS - (Date.now() - startedAt));
                window.setTimeout(() => setLoading(false), remainingDelay);
            });
    };

    useEffect(() => {
        const handleColorShortcut = (event) => {
            if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== 'c') return;
            event.preventDefault();
            const modes = ['kind'];
            if (hasClusterData) modes.push('cluster');
            setColorMode((currentMode) => modes[(modes.indexOf(currentMode) + 1) % modes.length]);
        };
        window.addEventListener('keydown', handleColorShortcut);
        return () => window.removeEventListener('keydown', handleColorShortcut);
    }, [hasClusterData]);

    const [minDate, setMinDate] = useState(null);
    const [maxDate, setMaxDate] = useState(null);
    const [timelineDate, setTimelineDate] = useState(null);

    useEffect(() => {
        if (!graphData?.nodes) return;
        const times = graphData.nodes
            .map(n => n.created_time ? new Date(n.created_time).getTime() : null)
            .filter(t => t !== null && !isNaN(t));

        if (times.length > 0) {
            const min = Math.min(...times);
            const max = Math.max(...times);
            setMinDate(min);
            setMaxDate(max);
            if (!timelineDate) setTimelineDate(max);
        }
    }, [graphData]);

    const fetchConfigData = () => {
        fetch('/api/config')
            .then(res => res.json())
            .then(data => setConfig(data))
            .catch(err => console.error("Error loading config:", err));
    };

    // Re-fetch when the Settings modals emit the event (without reloading).
    useConfigChanged(fetchConfigData);

    useEffect(() => {
        fetchGraphData();
        fetchConfigData();

        // Fetch table metadata for filter UI
        fetch('/api/vault/tables')
            .then(r => r.json())
            .then(data => setAvailableTables(data))
            .catch(e => console.error("Error fetching tables for filters:", e));

        // Global id→title map to resolve the values of reference-type
        // fields in filters (show the page title, not the id).
        fetch('/api/vault/global-index')
            .then(r => (r.ok ? r.json() : {}))
            .then(data => setIdTitleMap(data && typeof data === 'object' ? data : {}))
            .catch(e => console.error("Error fetching global index for filters:", e));

        // Watches the `.dark` class on documentElement so that overlays and the
        // graph canvas follow the app's theme live (not the OS).
        const root = document.documentElement;
        const syncTheme = () => setIsDarkMode(root.classList.contains('dark'));
        syncTheme();
        const themeObserver = new MutationObserver(syncTheme);
        themeObserver.observe(root, { attributes: true, attributeFilter: ['class'] });

        // Deep linking support
        const params = new URLSearchParams(location.search);
        const nodeToSelect = params.get('node');
        if (nodeToSelect) {
            // We set a small delay to wait for graph layout or data to be ready in the DOM
            setTimeout(() => {
                setSelectedNode(String(nodeToSelect));
                if (graphViewerRef.current) {
                    graphViewerRef.current.panToNode(String(nodeToSelect), 2.5);
                }
            }, 1500);
        }

        return () => themeObserver.disconnect();
    }, []);

    // Populate filter states from config
    useEffect(() => {
        if (!config?.graph) return;
        const g = config.graph;
        const seeded = !!g.sources_initialized;
        setSourcesInitialized(seeded);
        if (g.visible_databases) setVisibleDatabases(g.visible_databases);
        if (g.visible_tables) setVisibleTables(g.visible_tables);
        if (g.visible_fields) setVisibleFields(g.visible_fields);
        
        if (g.field_defaults) {
            const initialFilters = {};
            Object.entries(g.field_defaults).forEach(([fieldKey, defaultVal]) => {
                if (defaultVal) {
                    initialFilters[fieldKey] = new Set([defaultVal]);
                }
            });
            setFieldFilters(initialFilters);
        }

        // explicit graph_table_filters takes priority; if there isn't one, we derive it from visible_tables
        // (every table enabled in settings appears as a toggle in the graph sidebar)
        const tableFilters = g.graph_table_filters?.length > 0
            ? g.graph_table_filters
            : (g.visible_tables || []);
        setGraphTableFiltersSettings(tableFilters);
        // Wiki: once the sources are seeded, only if 'wiki' is explicitly present;
        // before seeding we preserve the legacy value (empty = everything visible).
        const wikiVisible = seeded
            ? g.visible_databases?.includes('wiki')
            : (!g.visible_databases?.length || g.visible_databases.includes('wiki'));
        setActiveTableFilters(new Set([...(wikiVisible ? ['__wiki__'] : []), ...tableFilters]));
        if (g.show_arrows !== undefined) setShowArrows(g.show_arrows);
        if (g.label_threshold) setLabelThreshold(g.label_threshold);
        if (g.node_size) setNodeSize(g.node_size);
        if (g.edge_thickness) setEdgeThickness(g.edge_thickness);

        const physics = g.physics || {};
        if (Number.isFinite(Number(physics.gravity))) {
            const value = Number(physics.gravity);
            setGravityUI(value);
            setGravity(value);
        }
        if (Number.isFinite(Number(physics.repulsion))) {
            const value = Number(physics.repulsion);
            setRepulsionUI(value);
            setRepulsion(value);
        }
        if (Number.isFinite(Number(physics.friction))) {
            const value = Number(physics.friction);
            setFrictionUI(value);
            setFriction(value);
        }
        if (Number.isFinite(Number(physics.edge_influence))) {
            const value = Number(physics.edge_influence);
            setEdgeInfluenceUI(value);
            setEdgeInfluence(value);
        }
        if (typeof physics.lin_log_mode === 'boolean') {
            setLinLogMode(physics.lin_log_mode);
        }
        if (typeof physics.strong_gravity_mode === 'boolean') {
            setStrongGravityMode(physics.strong_gravity_mode);
        }
        if (typeof physics.outbound_attraction_distribution === 'boolean') {
            setOutboundAttractionDistribution(physics.outbound_attraction_distribution);
        }
    }, [config]);

    // One-time source seeding: the first time (config without `sources_initialized`)
    // we mark ALL sources with content as visible and persist it. From
    // then on, disabling them all in Settings leaves the graph EMPTY (instead of
    // showing everything). This way a new user doesn't see a blank graph by default.
    useEffect(() => {
        if (!config?.graph || config.graph.sources_initialized) return;
        const nodes = graphData?.nodes;
        if (!nodes || nodes.length === 0) return;

        const dbSet = new Set();
        const tableSet = new Set();
        nodes.forEach(n => {
            const sysCat = getSystemCategory(n);
            if (sysCat) {
                dbSet.add(sysCat);
                const eff = getEffectiveTableId(n);
                if (eff) tableSet.add(eff);
            } else {
                const db = n.database_id || n.metadata?.database_id;
                const tbl = n.table_id || n.metadata?.table_id || n.metadata?.database_table_id;
                if (db) dbSet.add(db);
                if (tbl) tableSet.add(tbl);
            }
        });

        const seededDbs = [...dbSet];
        const seededTables = [...tableSet];
        // If we haven't derived any source, we don't mark it as initialized (this avoids a
        // permanently empty graph if the graph comes without classification).
        if (seededDbs.length === 0 && seededTables.length === 0) return;

        setVisibleDatabases(seededDbs);
        setVisibleTables(seededTables);
        setSourcesInitialized(true);

        fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                graph: {
                    sources_initialized: true,
                    visible_databases: seededDbs,
                    visible_tables: seededTables,
                },
            }),
        })
            .then(() => setConfig(c => (c ? { ...c, graph: { ...c.graph, sources_initialized: true, visible_databases: seededDbs, visible_tables: seededTables } } : c)))
            .catch(e => console.error('Error seeding the graph sources:', e));
    }, [config, graphData]);

    // (Removed the old 30s auto-refresh polling: it called
    // `POST /api/sync` and `GET /api/graph/version`, two endpoints that no longer
    // exist in the native backend — they only produced a repeated 404 in the console
    // and refreshed nothing. The graph reloads when entering and when changing the
    // settings/filters.)



    const handleSearchSubmit = (term) => {
        if (!graphData || !term) return;
        const lowerTerm = term.toLowerCase();
        const nodes = graphData.nodes || [];
        let match = nodes.find(n => n.label.toLowerCase() === lowerTerm);
        if (!match) {
            match = nodes.find(n => n.label.toLowerCase().startsWith(lowerTerm));
        }
        if (!match) {
            match = nodes.find(n => n.label.toLowerCase().includes(lowerTerm));
        }

        if (match) {
            setSelectedNode(String(match.key));
            if (graphViewerRef.current) {
                graphViewerRef.current.panToNode(String(match.key), 2.5);
            }
        }
    };

    const graphViewerRef = useRef(null);

    const pathResult = useMemo(() => {
        if (!graphInstance || !pathSource || !pathTarget) return null;
        if (!pathSource || !pathTarget) return null;

        const queue = [[pathSource]];
        const visited = new Set([pathSource]);

        while (queue.length > 0) {
            const path = queue.shift();
            const node = path[path.length - 1];

            if (node === pathTarget) {
                const nodes = new Set(path);
                const edges = new Set();
                for (let i = 0; i < path.length - 1; i++) {
                    const u = path[i];
                    const v = path[i + 1];
                    const edge = graphInstance.edge(u, v) || graphInstance.edge(v, u);
                    if (edge) edges.add(edge);
                }
                return { nodes, edges, fullPath: path };
            }

            graphInstance.neighbors(node).forEach(neighbor => {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push([...path, neighbor]);
                }
            });
        }
        return { nodes: new Set(), edges: new Set(), fullPath: [], noPath: true };
    }, [graphInstance, pathSource, pathTarget]);

    const filters = useMemo(() => ({
        activeClusters,
        activeKinds,
        activeProjects,
        showSemanticSuggestions,
        hideIsolated,
        onlyIsolated,
        selectedNode,
        depth,
        searchTerm,
        timelineDate,
        pathResult,
        visibleDatabases,
        visibleTables,
        sourcesInitialized,
        activeTableFilters,
        fieldFilters,
        graphTableFiltersSettings,
        activeMediaTags
    }), [activeClusters, activeKinds, activeProjects, showSemanticSuggestions, hideIsolated, onlyIsolated, selectedNode, depth, searchTerm, timelineDate, pathResult, visibleDatabases, visibleTables, sourcesInitialized, activeTableFilters, fieldFilters, graphTableFiltersSettings, activeMediaTags]);
    
    // Efficiently calculate filtered counts as derived state (Clean v6)
    // Match the body-wikilink topology rendered by GraphViewer and Obsidian.
    const memoizedGraph = useMemo(() => {
        if (!graphData?.nodes) return null;
        const g = new Graph();
        graphData.nodes.forEach(n => g.addNode(n.key, n));
        graphData.edges.forEach(e => {
            if (e.kind !== 'link' && !e.body_link) return;
            try { g.addEdge(e.source, e.target, e); } catch { /* Duplicate edge. */ }
        });
        return g;
    }, [graphData]);

    const hasSemanticData = useMemo(
        () => hasSemanticSuggestions(graphData?.edges),
        [graphData?.edges],
    );

    const { filteredNodesCount, filteredEdgesCount, connectionTypeCounts } = useMemo(() => {
        if (!memoizedGraph) return { filteredNodesCount: 0, filteredEdgesCount: 0, connectionTypeCounts: {} };
        const { visibleNodes, visibleEdges } = applyFilters(memoizedGraph, filters);
        const visibleSuggestions = getVisibleSemanticEdges(
            graphData?.edges,
            visibleNodes,
            showSemanticSuggestions,
        );
        return {
            filteredNodesCount: visibleNodes.size,
            filteredEdgesCount: visibleEdges.size,
            connectionTypeCounts: getConnectionTypeCounts(
                [
                    ...[...visibleEdges].map((edge) => memoizedGraph.getEdgeAttributes(edge)),
                    ...visibleSuggestions,
                ],
            ),
        };
    }, [memoizedGraph, filters, graphData?.edges, showSemanticSuggestions]);

    // Precomputes the available values for each configured field — O(nodes × fields) once per load
    const fieldValuesByKey = useMemo(() => {
        const result = {};
        visibleFields.forEach(fieldKey => {
            if (!fieldKey?.includes(':')) return;
            const [tableId, fieldName] = fieldKey.split(':');
            const vm = new Map();
            (graphData?.nodes || []).forEach(attrs => {
                if (getEffectiveTableId(attrs) !== tableId) return;
                toValueStrings(resolveMetaValue(attrs, fieldName))
                    .forEach(v => vm.set(v, (vm.get(v) || 0) + 1));
            });
            result[fieldKey] = Array.from(vm.entries()).sort((a, b) => b[1] - a[1]);
        });
        return result;
    }, [graphData, visibleFields]);

    // Combined id→title map: global-index + graph node labels (covers
    // pages present in the graph that might not be in the index). Used to resolve the title
    // of related pages in reference-type field filters.
    const idLabelResolver = useMemo(() => {
        const m = { ...idTitleMap };
        for (const n of (graphData?.nodes || [])) {
            const label = n.label;
            if (!label) continue;
            for (const k of [n.id, n.key, n.metadata?.id]) {
                if (k && !(String(k) in m)) m[String(k)] = label;
            }
        }
        return m;
    }, [idTitleMap, graphData]);

    // Fallback name for tables that are NOT in the registry (inline DBs from
    // the Notion import, without their own DB page in the vault): the last segment of
    // the FOLDER of the `path` of their rows ("BD/Cervell Digital/Titulacions/
    // x.md" → "Titulacions"). Without this, the Table Filter and the Field Filter
    // showed the raw hexadecimal id (13 unusable entries in the real vault).
    const folderNameByTableId = useMemo(() => {
        const m = new Map();
        for (const n of (graphData?.nodes || [])) {
            const tbl = n.table_id || n.metadata?.table_id || n.metadata?.database_table_id;
            if (!tbl || m.has(tbl)) continue;
            const segs = String(n.path || '').split('/').filter(Boolean);
            if (segs.length >= 2) m.set(tbl, segs[segs.length - 2]);
        }
        return m;
    }, [graphData]);

    // Label to display for a filter value: if it's the id of a known page
    // → its title; if it looks like an unresolved id (UUID/Notion) (dangling relation)
    // → shortened form instead of the full UUID; otherwise → the value as-is
    // (e.g. select options like "Finished").
    const displayFieldValue = (val) => {
        const s = String(val);
        if (idLabelResolver[s]) return idLabelResolver[s];
        const looksLikeId = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(s)
            || /^[0-9a-f]{32}$/i.test(s);
        return looksLikeId ? s.slice(0, 8) + '…' : s;
    };

    if (loading) {
        return <GraphLoadingState progress={loadingProgress} />;
    }

    return (
        <Layout
            sidebar={
                <Sidebar
                    searchTerm={searchTerm}
                    onSearchChange={setSearchTerm}
                    showSemanticSuggestions={showSemanticSuggestions}
                    onShowSemanticSuggestionsChange={setShowSemanticSuggestions}
                    hasSemanticData={hasSemanticData}
                    hideIsolated={hideIsolated}
                    onHideIsolatedChange={(checked) => {
                        setHideIsolated(checked);
                        if (checked) setOnlyIsolated(false);
                    }}
                    onlyIsolated={onlyIsolated}
                    onOnlyIsolatedChange={(checked) => {
                        setOnlyIsolated(checked);
                        if (checked) setHideIsolated(false);
                    }}
                    onSearchSubmit={handleSearchSubmit}
                    minDate={minDate}
                    maxDate={maxDate}
                    timelineDate={timelineDate}
                    onTimelineChange={setTimelineDate}
                    colorMode={colorMode}
                    onColorModeChange={setColorMode}
                    hasClusterData={hasClusterData}
                    isPathfindingMode={isPathfindingMode}
                    onPathfindingModeChange={setIsPathfindingMode}
                    pathSource={pathSource}
                    pathTarget={pathTarget}
                    onClearPath={() => { setPathSource(null); setPathTarget(null); }}
                    pathResult={pathResult}
                    getNodeLabel={(id) => graphInstance?.getNodeAttribute(id, 'label') || id}
                    // Pass Visualization and Forces to the bottom of Sidebar
                    afterWidgets={
                        <div style={{ marginTop: '20px', paddingRight: '10px' }}>
                            <VisualizationSection
                                showArrows={showArrows}
                                onShowArrowsChange={setShowArrows}
                                labelThreshold={labelThreshold}
                                onLabelThresholdChange={setLabelThreshold}
                                nodeSize={nodeSize}
                                onNodeSizeChange={setNodeSize}
                                edgeThickness={edgeThickness}
                                onEdgeThicknessChange={setEdgeThickness}
                            />
                            <ForcesSection
                                gravity={gravityUI}
                                onGravityChange={setGravityUI}
                                repulsion={repulsionUI}
                                onRepulsionChange={setRepulsionUI}
                                friction={frictionUI}
                                onFrictionChange={setFrictionUI}
                                edgeInfluence={edgeInfluenceUI}
                                onEdgeInfluenceChange={setEdgeInfluenceUI}
                                linLogMode={linLogMode}
                                onLinLogModeChange={setLinLogMode}
                                strongGravityMode={strongGravityMode}
                                onStrongGravityModeChange={setStrongGravityMode}
                                outboundAttractionDistribution={outboundAttractionDistribution}
                                onOutboundAttractionDistributionChange={setOutboundAttractionDistribution}
                            />
                        </div>
                    }
                >
                    {/* Table Filters */}
                    <CollapsibleSection title={t('graph.filters.tables_title', "Table Filter")} badge={activeTableFilters.size}>
                        <div className="filter-list">
                            {/* Wiki: only if visible_databases is empty or includes 'wiki' */}
                            {(visibleDatabases.length === 0 || visibleDatabases.includes('wiki')) && <div className="filter-item-advanced">
                                <input
                                    type="checkbox"
                                    id="table-filter-__wiki__"
                                    checked={activeTableFilters.has('__wiki__')}
                                    onChange={() => {
                                        const newSet = new Set(activeTableFilters);
                                        if (newSet.has('__wiki__')) newSet.delete('__wiki__');
                                        else newSet.add('__wiki__');
                                        setActiveTableFilters(newSet);
                                    }}
                                    style={{ display: 'none' }}
                                />
                                <label htmlFor="table-filter-__wiki__" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                    <span className="custom-checkbox" style={{ backgroundColor: '#9C27B0', opacity: activeTableFilters.has('__wiki__') ? 1 : 0.3 }}>
                                        {activeTableFilters.has('__wiki__') && <Check size={10} color="white" />}
                                    </span>
                                    <span className="filter-label-text">📄 {t('graph.filters.wiki_pages', "Wiki Pages")}</span>
                                </label>
                            </div>}
                            {/* Configured table filters */}
                            {graphTableFiltersSettings.map(tableId => {
                                const table = (availableTables || []).find(t => t?.id === tableId)
                                    || { name: folderNameByTableId.get(tableId) || tableId };
                                return (
                                    <div key={tableId} className="filter-item-advanced">
                                        <input
                                            type="checkbox"
                                            id={`table-filter-${tableId}`}
                                            checked={activeTableFilters.has(tableId)}
                                            onChange={() => {
                                                const newSet = new Set(activeTableFilters);
                                                if (newSet.has(tableId)) newSet.delete(tableId);
                                                else newSet.add(tableId);
                                                setActiveTableFilters(newSet);
                                            }}
                                            style={{ display: 'none' }}
                                        />
                                        <label htmlFor={`table-filter-${tableId}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                            <span className="custom-checkbox" style={{ backgroundColor: 'var(--gnosi-blue)', opacity: activeTableFilters.has(tableId) ? 1 : 0.3 }}>
                                                {activeTableFilters.has(tableId) && <Check size={10} color="white" />}
                                            </span>
                                            <span className="filter-label-text">{table.name}</span>
                                        </label>
                                    </div>
                                );
                            })}
                        </div>
                    </CollapsibleSection>

                    {/* Media Tags Filters (New) */}
                    {graphData?.nodes?.some(n => n.kind === 'media') && (
                        <CollapsibleSection title={t('graph.filters.media_tags_title', "Photo Tags Filter")} badge={activeMediaTags.size} defaultOpen={true}>
                            <div className="filter-list">
                                {mediaTagsList.map(tag => (
                                    <div key={tag} className="filter-item-advanced">
                                        <input
                                            type="checkbox"
                                            id={`media-tag-${tag}`}
                                            checked={activeMediaTags.has(tag)}
                                            onChange={() => {
                                                const newSet = new Set(activeMediaTags);
                                                if (newSet.has(tag)) newSet.delete(tag);
                                                else newSet.add(tag);
                                                setActiveMediaTags(newSet);
                                            }}
                                            style={{ display: 'none' }}
                                        />
                                        <label htmlFor={`media-tag-${tag}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                            <span className="custom-checkbox" style={{ backgroundColor: '#ec4899', opacity: activeMediaTags.has(tag) ? 1 : 0.3 }}>
                                                {activeMediaTags.has(tag) && <Check size={10} color="white" />}
                                            </span>
                                            <span className="filter-label-text">#{tag}</span>
                                        </label>
                                    </div>
                                ))}
                                {Array.from(new Set(graphData.nodes.filter(n => n.kind === 'media').flatMap(n => n.metadata?.tags || []))).length === 0 && (
                                    <p style={{ fontSize: '0.75rem', color: '#888', margin: '10px 0' }}>{t('graph.filters.no_tags_found', "No tags found in photos")}</p>
                                )}
                            </div>
                        </CollapsibleSection>
                    )}

                    {/* Field Value Filters (dynamic) */}
                    {visibleFields.length > 0 && (
                        <CollapsibleSection title={t('graph.filters.fields_title', "Field Filter")} badge={visibleFields.length}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '10px' }}>
                                {visibleFields.map(fieldKey => {
                                    if (!fieldKey || !fieldKey.includes(':')) return null;
                                    const [tableId, fieldName] = fieldKey.split(':');
                                    let tableName = tableId;
                                    const table = (availableTables || []).find(t => t?.id === tableId);
                                    
                                    if (table && table.name) {
                                        tableName = table.name;
                                    } else {
                                        // Specific system entity labels
                                        if (tableId === 'wiki') tableName = t('graph.entities.wiki', 'Wiki');
                                        else if (tableId === 'drawings') tableName = t('graph.entities.drawings', "Drawings");
                                        else if (tableId === 'images') tableName = t('graph.entities.images', "Images");
                                        else if (tableId === 'assets') tableName = t('graph.entities.attachments', "Attachments");
                                        else if (tableId.startsWith('calendar:')) tableName = t('graph.entities.calendar', "Calendar");
                                        else if (tableId.startsWith('contact:')) tableName = t('graph.entities.contact', "Contact");
                                        else if (tableId.startsWith('mail:')) tableName = t('graph.entities.mail', 'Mail');
                                        else if (folderNameByTableId.get(tableId)) tableName = folderNameByTableId.get(tableId);
                                    }

                                    const sortedValues = fieldValuesByKey[fieldKey] || [];

                                    return (
                                        <div key={fieldKey} style={{ background: 'var(--bg-secondary)', padding: '10px', borderRadius: '8px' }}>
                                            <h5 style={{ fontSize: '0.8rem', margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                <span style={{ fontSize: '12px' }}>⚙</span>
                                                {tableName}: {fieldName}
                                            </h5>
                                            {sortedValues.length === 0 ? (
                                                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                                                    {t('graph.filters.no_values', "No values (the graph is empty)")}
                                                </p>
                                            ) : (
                                            <div className="filter-list" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                                                {sortedValues.map(([val, count]) => {
                                                    const isActive = fieldFilters[fieldKey]?.has(val);
                                                    return (
                                                        <div key={val} className="filter-item-advanced" style={{ marginBottom: '4px' }}>
                                                            <input
                                                                type="checkbox"
                                                                id={`field-${fieldKey}-${val}`}
                                                                checked={isActive}
                                                                onChange={() => {
                                                                    setFieldFilters(prev => {
                                                                        const newFilters = { ...prev };
                                                                        const currentSet = new Set(newFilters[fieldKey] || []);
                                                                        if (currentSet.has(val)) currentSet.delete(val);
                                                                        else currentSet.add(val);
                                                                        newFilters[fieldKey] = currentSet;
                                                                        return newFilters;
                                                                    });
                                                                }}
                                                                style={{ display: 'none' }}
                                                            />
                                                            <label htmlFor={`field-${fieldKey}-${val}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                                <span className="custom-checkbox" style={{ width: '14px', height: '14px', backgroundColor: 'var(--gnosi-blue)', opacity: isActive ? 1 : 0.2 }}>
                                                                    {isActive && <Check size={8} color="white" />}
                                                                </span>
                                                                <span className="filter-label-text" style={{ fontSize: '0.75rem' }} title={String(val)}>{displayFieldValue(val)} ({count})</span>
                                                            </label>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </CollapsibleSection>
                    )}

                    {/* Info message when no filters are configured */}
                    {graphTableFiltersSettings.length === 0 && visibleFields.length === 0 && (
                        <div style={{ padding: '15px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                            <p>{t('graph.filters.none_configured', "No filters configured.")}</p>
                            <p style={{ marginTop: '5px' }}>
                                <Trans i18nKey="graph.filters.none_configured_hint">
                                    Ves a <strong>Configuració → Graf</strong> per seleccionar taules i camps.
                                </Trans>
                            </p>
                        </div>
                    )}

                    {selectedNode && (
                        <div className="section">
                            <div id="depth-controls" className="depth-controls" style={{ display: 'block' }}>
                                <p>{t('graph.selection.showing_neighbors_of', "Showing neighbors of:")}</p>
                                <strong>
                                    {graphInstance ? (graphInstance.getNodeAttribute(selectedNode, 'label') || selectedNode) : selectedNode}
                                </strong>
                                <div className="depth-slider-container">
                                    <label htmlFor="depth-slider">{t('depth_filter')}:</label>
                                    <input
                                        type="range"
                                        id="depth-slider"
                                        min="1"
                                        max="5"
                                        value={depth}
                                        step="1"
                                        onChange={(e) => setDepth(parseInt(e.target.value))}
                                    />
                                    <span id="depth-label">{depth}</span>
                                </div>
                                <button id="clear-selection-btn" onClick={() => setSelectedNode(null)}>{t('graph.selection.clear', "Clear selection")}</button>
                            </div>
                        </div>
                    )}
                </Sidebar>
            }
            controls={
                <Controls
                    onZoomIn={() => graphViewerRef.current?.zoomIn()}
                    onZoomOut={() => graphViewerRef.current?.zoomOut()}
                    onCenter={() => graphViewerRef.current?.center()}
                    onFullscreen={() => graphViewerRef.current?.fullscreen()}
                    legend={(
                        <Legend
                            graphData={graphData}
                            colorMode={colorMode}
                            filteredNodesCount={filteredNodesCount}
                            filteredEdgesCount={filteredEdgesCount}
                            connectionTypeCounts={connectionTypeCounts}
                        />
                    )}
                />
            }
            bottomPanel={
                <div style={{ padding: '20px', background: isDarkMode ? '#111' : '#f7f7f7' }}>
                    <ConnectionList graphInstance={graphInstance} graphData={graphData} filters={filters} />
                </div>
            }
            containerStyle={{ display: 'block' }}
        >
            <div style={{ height: '100%', position: 'relative', minHeight: '600px' }}>
                {/* Partial-graph warning: the backend skipped unreadable vault dirs
                    (wedged online-only OneDrive subtrees) and served what it could.
                    The result is NOT cached server-side, so a retry re-attempts a
                    full build. Tooltip lists the skipped folders for diagnosis. */}
                {graphData?.partial && (
                    <div
                        className="absolute top-4 left-1/2 -translate-x-1/2 z-30 max-w-xl px-4 py-2 bg-amber-50 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded-lg shadow-md flex items-center gap-3"
                        title={(graphData.skipped_dirs || []).join('\n')}
                    >
                        <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />
                        <span className="text-sm text-amber-800 dark:text-amber-200">
                            <strong>{t('graph.partial_warning.title', "Partial graph")}:</strong>{' '}
                            {t('graph.partial_warning.message', {
                                count: (graphData.skipped_dirs || []).length,
                                defaultValue: "{{count}} vault folders could not be read (cloud still syncing); the graph is incomplete.",
                            })}
                        </span>
                        <button
                            onClick={() => fetchGraphData()}
                            className="shrink-0 px-2.5 py-1 text-xs font-medium rounded-md bg-amber-600 hover:bg-amber-700 text-white"
                        >
                            {t('graph.partial_warning.retry', "Retry")}
                        </button>
                    </div>
                )}
                <GraphViewer
                    ref={graphViewerRef}
                    graphData={graphData}
                    setGraphInstance={setGraphInstance}
                    setRendererInstance={setRendererInstance}
                    filters={filters}
                    isPhysicsEnabled={isPhysicsEnabled}
                    onNodeClick={(node) => setSelectedNode(node)}
                    isPathfindingMode={isPathfindingMode}
                    pathSource={pathSource}
                    pathTarget={pathTarget}
                    onSelectPathNode={(nodeId) => {
                        if (!pathSource) setPathSource(nodeId);
                        else if (!pathTarget) setPathTarget(nodeId);
                        else {
                            setPathSource(nodeId);
                            setPathTarget(null);
                        }
                    }}
                    // Visualization props
                    showArrows={showArrows}
                    labelThreshold={labelThreshold}
                    nodeSize={nodeSize}
                    edgeThickness={edgeThickness}
                    // Physics props
                    gravity={gravity}
                    repulsion={repulsion}
                    friction={friction}
                    edgeInfluence={edgeInfluence}
                    linLogMode={linLogMode}
                    strongGravityMode={strongGravityMode}
                    outboundAttractionDistribution={outboundAttractionDistribution}
                />
                <Minimap
                    graph={graphInstance}
                    mainRenderer={rendererInstance}
                    isDarkMode={isDarkMode}
                    onPanToGraph={(x, y, ratio) => graphViewerRef.current?.panToGraphPoint(x, y, ratio)}
                    onPanToNode={(nodeId, ratio) => graphViewerRef.current?.panToNode(nodeId, ratio)}
                    onCenter={() => graphViewerRef.current?.center()}
                />
                <NodeDetailsPanel
                    nodeId={selectedNode}
                    initialData={selectedNode && graphInstance ? graphInstance.getNodeAttributes(selectedNode) : null}
                    isOpen={!!selectedNode}
                    onClose={() => setSelectedNode(null)}
                />
            </div>
        </Layout>
    );
}

export default GraphPage;
