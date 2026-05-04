import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { RefreshCw, Check } from 'lucide-react';
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
import { applyFilters } from '../utils/graphFilters';


import { NodeDetailsPanel } from '../components/NodeDetailsPanel';
import '../viewer/style.css';

function GraphPage() {
    const { t } = useTranslation();
    const [graphData, setGraphData] = useState(null);
    const [graphInstance, setGraphInstance] = useState(null);
    const [rendererInstance, setRendererInstance] = useState(null);
    const [isDarkMode, setIsDarkMode] = useState(window.matchMedia('(prefers-color-scheme: dark)').matches);

    const [isPhysicsEnabled, setIsPhysicsEnabled] = useState(true);

    // Filter State
    const [searchTerm, setSearchTerm] = useState("");
    const [similarity, setSimilarity] = useState(100);
    const [hideIsolated, setHideIsolated] = useState(false);
    const [onlyIsolated, setOnlyIsolated] = useState(false);
    const [activeClusters, setActiveClusters] = useState(new Set());
    const [activeKinds, setActiveKinds] = useState(new Set());
    const [activeProjects, setActiveProjects] = useState(new Set());
    const [colorMode, setColorMode] = useState('kind');

    // Visibility & Configuration (from config.graph)
    const [visibleDatabases, setVisibleDatabases] = useState([]);
    const [visibleTables, setVisibleTables] = useState([]);
    const [visibleFields, setVisibleFields] = useState([]); // Array of "tableId:fieldName"
    const [graphTableFiltersSettings, setGraphTableFiltersSettings] = useState([]); // Which tables HAVE a toggle
    const [activeTableFilters, setActiveTableFilters] = useState(new Set()); // Which table toggles are ON
    const [activeMediaTags, setActiveMediaTags] = useState(new Set()); // New: Tags specifically for media

    // Dynamic Field Filters
    // Map of "tableId:fieldName" -> Set of active values
    const [fieldFilters, setFieldFilters] = useState({});
    const [availableTables, setAvailableTables] = useState([]);

    // Visualization State
    const [showArrows, setShowArrows] = useState(true);
    const [labelThreshold, setLabelThreshold] = useState(14);
    const [nodeSize, setNodeSize] = useState(1.0);
    const [edgeThickness, setEdgeThickness] = useState(1.2);

    // Physics State - UI (Instant feedback for sliders)
    const [gravityUI, setGravityUI] = useState(0.01);   // Increased Gravity
    const [repulsionUI, setRepulsionUI] = useState(15000); // Increased Repulsion
    const [frictionUI, setFrictionUI] = useState(2.5);    // Increased Friction
    const [edgeInfluenceUI, setEdgeInfluenceUI] = useState(5); // High Link Force

    const [linLogMode, setLinLogMode] = useState(false); // Vanilla

    // Sync State
    const [isSyncing, setIsSyncing] = useState(false);

    // Physics State - Real (Debounced for ForceAtlas2)
    const [gravity, setGravity] = useState(0.005);
    const [repulsion, setRepulsion] = useState(2000);
    const [friction, setFriction] = useState(1.5);
    const [edgeInfluence, setEdgeInfluence] = useState(5);


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
    const [graphVersion, setGraphVersion] = useState(null);

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
        if (!isBackground) setLoading(true);

        fetch('/api/graph').then(res => {
            if (!res.ok) throw new Error(`Graph API error: ${res.status}`);
            // Store version from header
            const version = res.headers.get('X-Graph-Version');
            if (version) setGraphVersion(version);
            return res.json();
        }).then(graph => {
            // Fetch suggestions separately
            return fetch('/api/system/suggestions')
                .then(res => res.ok ? res.json() : [])
                .catch(() => [])
                .then(suggestions => ({ graph, suggestions }));
        }).then(({ graph, suggestions }) => {
            // Merge suggestions into graph edges
            if (Array.isArray(suggestions)) {
                const existingEdges = new Set((graph.edges || []).map(e => `${e.source}-${e.target}`));

                suggestions.forEach(s => {
                    const edgeId = `${s.source}-${s.target}`;
                    if (!existingEdges.has(edgeId)) {
                        if (!graph.edges) graph.edges = [];
                        graph.edges.push({
                            ...s,
                            id: `suggestion-${edgeId}`,
                            kind: 'suggestion',
                            color: '#FF4081',
                            size: 1,
                            dashed: true
                        });
                        existingEdges.add(edgeId);
                    }
                });

                if (graph.legend && graph.legend.kinds && !graph.legend.kinds.find(k => k.label === 'Suggestion')) {
                    graph.legend.kinds.push({ label: 'Suggestion', color: '#FF4081', count: suggestions.length });
                }
            }
            setGraphData(graph);
        })
            .catch(err => {
                console.error("Error loading graph data:", err);
                setGraphData({ nodes: [], edges: [], legend: { kinds: [], clusters: [] } });
            })
            .finally(() => {
                setLoading(false);
            });
    };

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

    useEffect(() => {
        fetchGraphData();
        fetch('/api/config')
            .then(res => res.json())
            .then(data => setConfig(data))
            .catch(err => console.error("Error loading config:", err));

        // Fetch table metadata for filter UI
        fetch('/api/vault/tables')
            .then(r => r.json())
            .then(data => setAvailableTables(data))
            .catch(e => console.error("Error fetching tables for filters:", e));

        const matcher = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = (e) => setIsDarkMode(e.matches);
        matcher.addEventListener('change', onChange);
        return () => matcher.removeEventListener('change', onChange);
    }, []);

    // Populate filter states from config
    useEffect(() => {
        if (!config?.graph) return;
        const g = config.graph;
        if (g.visible_databases) setVisibleDatabases(g.visible_databases);
        if (g.visible_tables) setVisibleTables(g.visible_tables);
        if (g.visible_fields) setVisibleFields(g.visible_fields);
        if (g.graph_table_filters) {
            setGraphTableFiltersSettings(g.graph_table_filters);
            setActiveTableFilters(new Set(['__wiki__', ...g.graph_table_filters]));
        } else {
            setActiveTableFilters(new Set(['__wiki__']));
        }
        if (g.show_arrows !== undefined) setShowArrows(g.show_arrows);
        if (g.label_threshold) setLabelThreshold(g.label_threshold);
        if (g.node_size) setNodeSize(g.node_size);
        if (g.edge_thickness) setEdgeThickness(g.edge_thickness);
    }, [config]);

    useEffect(() => {
        const interval = setInterval(async () => {
            try {
                // 1. Trigger sync
                const syncRes = await fetch('/api/sync', { method: 'POST' });
                if (syncRes.status === 429) {
                    console.warn("⏳ Sync skipped (already in progress)");
                    return;
                }
                if (!syncRes.ok) {
                    console.error("❌ Sync failed:", syncRes.status);
                    return;
                }

                // 2. Check if version changed
                const versionRes = await fetch('/api/graph/version');
                if (!versionRes.ok) return;
                const { version: newVersion } = await versionRes.json();

                if (newVersion && newVersion !== graphVersion) {
                    console.log("📊 Graph version changed, reloading...");
                    fetchGraphData(true);
                } else {
                    console.log("✅ Sync completed, no changes detected.");
                }
            } catch (err) {
                console.error("❌ Sync error:", err);
            }
        }, 30000);
        return () => clearInterval(interval);
    }, [graphVersion]);



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
            console.log("Found match:", match.label);
            setSelectedNode(String(match.key));
            if (graphViewerRef.current) {
                graphViewerRef.current.panToNode(String(match.key), 2.5);
            }
        } else {
            console.log("No match found for", term);
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
        similarity,
        hideIsolated,
        onlyIsolated,
        selectedNode,
        depth,
        searchTerm,
        timelineDate,
        pathResult,
        visibleDatabases,
        visibleTables,
        activeTableFilters,
        fieldFilters,
        graphTableFiltersSettings,
        activeMediaTags
    }), [activeClusters, activeKinds, activeProjects, similarity, hideIsolated, onlyIsolated, selectedNode, depth, searchTerm, timelineDate, pathResult, visibleDatabases, visibleTables, activeTableFilters, fieldFilters, graphTableFiltersSettings, activeMediaTags]);
    
    // Efficiently calculate filtered counts as derived state (Clean v6)
    const memoizedGraph = useMemo(() => {
        if (!graphData?.nodes) return null;
        const g = new Graph();
        graphData.nodes.forEach(n => g.addNode(n.key, n));
        graphData.edges.forEach(e => g.addEdge(e.source, e.target, e));
        return g;
    }, [graphData]);

    const { filteredNodesCount, filteredEdgesCount } = useMemo(() => {
        if (!memoizedGraph) return { filteredNodesCount: 0, filteredEdgesCount: 0 };
        const { visibleNodes, visibleEdges } = applyFilters(memoizedGraph, filters);
        return { 
            filteredNodesCount: visibleNodes.size, 
            filteredEdgesCount: visibleEdges.size 
        };
    }, [memoizedGraph, filters]);




    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-50 flex-col gap-4">
                <div className="text-4xl animate-bounce">🧠</div>
                <div className="text-xl font-medium text-gray-600 animate-pulse">Carregant el Cervell Digital...</div>
                <div className="text-sm text-gray-400">Connectant neurones...</div>
            </div>
        );
    }



    const handleSync = async () => {
        if (isSyncing) return;
        setIsSyncing(true);
        const toastId = toast.loading('Sincronitzant dades...');
        try {
            const res = await fetch('/api/sync', { method: 'POST' });
            if (!res.ok) throw new Error('Sync failed');
            toast.success('Sincronització completada!', { id: toastId });
            window.location.reload();
        } catch (e) {
            console.error(e);
            toast.error('Error al sincronitzar', { id: toastId });
        } finally {
            setIsSyncing(false);
        }
    };

    return (
        <Layout

            onSync={handleSync}
            isSyncing={isSyncing}
            sidebar={
                <Sidebar
                    searchTerm={searchTerm}
                    onSearchChange={setSearchTerm}
                    similarity={similarity}
                    onSimilarityChange={setSimilarity}
                    hideIsolated={hideIsolated}
                    onHideIsolatedChange={setHideIsolated}
                    onlyIsolated={onlyIsolated}
                    onOnlyIsolatedChange={setOnlyIsolated}
                    onSearchSubmit={handleSearchSubmit}
                    minDate={minDate}
                    maxDate={maxDate}
                    timelineDate={timelineDate}
                    onTimelineChange={setTimelineDate}
                    colorMode={colorMode}
                    onColorModeChange={setColorMode}
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
                            />
                        </div>
                    }
                >
                    {/* Table Filters */}
                    <CollapsibleSection title="Filtre de Taules" badge={activeTableFilters.size} defaultOpen={true}>
                        <div className="filter-list">
                            {/* Default: Wiki pages (no table) */}
                            <div className="filter-item-advanced">
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
                                    <span className="filter-label-text">📄 Pàgines Wiki</span>
                                </label>
                            </div>
                            {/* Configured table filters */}
                            {graphTableFiltersSettings.map(tableId => {
                                const table = availableTables.find(t => t.id === tableId) || { name: tableId };
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
                        <CollapsibleSection title="Filtre de Tags de Fotos" badge={activeMediaTags.size} defaultOpen={true}>
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
                                    <p style={{ fontSize: '0.75rem', color: '#888', margin: '10px 0' }}>Cap etiqueta trobada en fotos</p>
                                )}
                            </div>
                        </CollapsibleSection>
                    )}

                    {/* Field Value Filters (dynamic) */}
                    {visibleFields.length > 0 && (
                        <CollapsibleSection title="Filtre de Camps" badge={visibleFields.length} defaultOpen={true}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '10px' }}>
                                {visibleFields.map(fieldKey => {
                                    const [tableId, fieldName] = fieldKey.split(':');
                                    const table = availableTables.find(t => t.id === tableId) || { name: tableId };
                                    const fieldDef = (table.properties || table.fields || []).find(f => f.name === fieldName);

                                    // Calculate available values for this field
                                    const valuesMap = new Map();

                                    // 1. Try from graph data (current nodes)
                                    if (graphInstance) {
                                        graphInstance.forEachNode((node, attrs) => {
                                            const nodeTable = attrs.table_id || attrs.database_table_id;
                                            if (nodeTable === tableId) {
                                                const val = attrs[fieldName] || attrs.metadata?.[fieldName];
                                                if (val !== undefined && val !== null && val !== "") {
                                                    valuesMap.set(val, (valuesMap.get(val) || 0) + 1);
                                                }
                                            }
                                        });
                                    }

                                    // 2. Fallback: use field definition options (select/multi_select)
                                    if (valuesMap.size === 0 && fieldDef) {
                                        const options = fieldDef.settings?.options || fieldDef.select?.options || fieldDef.multi_select?.options || fieldDef.options;
                                        if (options) {
                                            options.forEach(opt => {
                                                const val = typeof opt === 'string' ? opt : (opt.name || opt.value);
                                                if (val) valuesMap.set(val, 0);
                                            });
                                        }
                                    }

                                    const sortedValues = Array.from(valuesMap.entries())
                                        .sort((a, b) => b[1] - a[1]);

                                    return (
                                        <div key={fieldKey} style={{ background: 'var(--bg-secondary)', padding: '10px', borderRadius: '8px' }}>
                                            <h5 style={{ fontSize: '0.8rem', margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                <span style={{ fontSize: '12px' }}>⚙</span>
                                                {table.name}: {fieldName}
                                            </h5>
                                            {sortedValues.length === 0 ? (
                                                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                                                    Sense valors (el graf està buit)
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
                                                                <span className="filter-label-text" style={{ fontSize: '0.75rem' }}>{String(val)} ({count})</span>
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
                            <p>No hi ha filtres configurats.</p>
                            <p style={{ marginTop: '5px' }}>Ves a <strong>Configuració → Graf</strong> per seleccionar taules i camps.</p>
                        </div>
                    )}

                    {selectedNode && (
                        <div className="section">
                            <div id="depth-controls" className="depth-controls" style={{ display: 'block' }}>
                                <p>Mostrant veïns de:</p>
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
                                <button id="clear-selection-btn" onClick={() => setSelectedNode(null)}>Neteja la selecció</button>
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
                    isPhysicsEnabled={isPhysicsEnabled}
                    setIsPhysicsEnabled={setIsPhysicsEnabled}
                />
            }
            bottomPanel={
                <div style={{ padding: '20px', background: isDarkMode ? '#111' : '#f7f7f7' }}>
                    <ConnectionList graphInstance={graphInstance} filters={filters} isDarkMode={isDarkMode} />
                </div>
            }
            containerStyle={{ display: 'block' }}
        >
            <div style={{ height: '100%', position: 'relative', minHeight: '600px' }}>
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
                />
                <Legend 
                    graphData={graphData} 
                    isDarkMode={isDarkMode} 
                    colorMode={colorMode} 
                    filteredNodesCount={filteredNodesCount}
                    filteredEdgesCount={filteredEdgesCount}
                />

                <Minimap
                    graph={graphInstance}
                    mainRenderer={rendererInstance}
                    isDarkMode={isDarkMode}
                    onPanTo={(x, y, ratio) => graphViewerRef.current?.panTo(x, y, ratio)}
                    onPanToNode={(nodeId, ratio) => graphViewerRef.current?.panToNode(nodeId, ratio)}
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
