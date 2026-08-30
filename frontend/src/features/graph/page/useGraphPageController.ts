import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation } from 'react-router-dom';

import type { MinimapRenderer } from '../../../components/minimapRuntime';
import { useConfigChanged } from '../../../lib/configEvents';
import { logError } from '../../../lib/notifyError';
import { fetchConfiguration, updateConfiguration } from '../../../shared/api/configuration';
import { fetchVaultGraph } from '../../../shared/api/graph';
import type { VaultGlobalIndex, VaultRegistryRecord } from '../../../shared/api/vaults';
import { fetchVaultGlobalIndex, fetchVaultTables } from '../../../shared/api/vaults';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { applyFilters } from '../../../utils/graphFilters';
import { getConnectionTypeCounts } from '../../../utils/graphLegend';
import {
  getVisibleSemanticEdges,
  hasSemanticSuggestions,
} from '../../../utils/semanticOverlay';
import {
  buildFilterGraph,
  deriveFieldValues,
  deriveFolderNames,
  deriveGraphSources,
  deriveIdLabels,
  deriveMediaTags,
  deriveTimelineRange,
  displayGraphFieldValue,
  findShortestPath,
  graphSettingsFromDocument,
  seedGraphConfigurationDocument,
  type FieldFilters,
  type GraphData,
  type GraphPageGraph,
} from './graphPageModel';


const MINIMUM_LOADING_DURATION_MS = 900;


export interface GraphViewerHandle {
  center(): void;
  fullscreen(): void;
  panToGraphPoint(x: number, y: number, ratio: number): void;
  panToNode(nodeId: string, ratio?: number | null): void;
  zoomIn(): void;
  zoomOut(): void;
}


function tableId(record: VaultRegistryRecord): string | null {
  const value = record.id;
  return typeof value === 'string' ? value : null;
}


function tableName(record: VaultRegistryRecord): string | null {
  const value = record.name;
  return typeof value === 'string' ? value : null;
}


export function useGraphPageController() {
  const location = useLocation();
  const initialSearch = useRef(location.search);
  const graphViewerRef = useRef<GraphViewerHandle>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [graphInstance, setGraphInstance] = useState<GraphPageGraph | null>(null);
  const [rendererInstance, setRendererInstance] = useState<MinimapRenderer | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(
    () => document.documentElement.classList.contains('dark'),
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [showSemanticSuggestions, setShowSemanticSuggestions] = useState(true);
  const [hideIsolated, setHideIsolatedState] = useState(false);
  const [onlyIsolated, setOnlyIsolatedState] = useState(false);
  const [activeClusters] = useState<ReadonlySet<string>>(() => new Set());
  const [activeKinds] = useState<ReadonlySet<string>>(() => new Set());
  const [activeProjects] = useState<ReadonlySet<string>>(() => new Set());
  const [colorMode, setColorMode] = useState('kind');
  const [visibleDatabases, setVisibleDatabases] = useState<string[]>([]);
  const [visibleTables, setVisibleTables] = useState<string[]>([]);
  const [sourcesInitialized, setSourcesInitialized] = useState(false);
  const [visibleFields, setVisibleFields] = useState<string[]>([]);
  const [graphTableFiltersSettings, setGraphTableFiltersSettings] = useState<string[]>([]);
  const [activeTableFilters, setActiveTableFilters] = useState<Set<string>>(() => new Set());
  const [activeMediaTags, setActiveMediaTags] = useState<Set<string>>(() => new Set());
  const [fieldFilters, setFieldFilters] = useState<FieldFilters>({});
  const [availableTables, setAvailableTables] = useState<VaultRegistryRecord[]>([]);
  const [idTitleMap, setIdTitleMap] = useState<VaultGlobalIndex>({});
  const [showArrows, setShowArrows] = useState(true);
  const [labelThreshold, setLabelThreshold] = useState(14);
  const [nodeSize, setNodeSize] = useState(0.4);
  const [edgeThickness, setEdgeThickness] = useState(0.05);
  const [gravityUI, setGravityUI] = useState(0.1);
  const [repulsionUI, setRepulsionUI] = useState(1000);
  const [frictionUI, setFrictionUI] = useState(10);
  const [edgeInfluenceUI, setEdgeInfluenceUI] = useState(0);
  const [linLogMode, setLinLogMode] = useState(false);
  const [strongGravityMode, setStrongGravityMode] = useState(true);
  const [outboundAttractionDistribution, setOutboundAttractionDistribution] = useState(false);
  const [gravity, setGravity] = useState(0.1);
  const [repulsion, setRepulsion] = useState(1000);
  const [friction, setFriction] = useState(10);
  const [edgeInfluence, setEdgeInfluence] = useState(0);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  const [isPathfindingMode, setPathfindingModeState] = useState(false);
  const [pathSource, setPathSource] = useState<string | null>(null);
  const [pathTarget, setPathTarget] = useState<string | null>(null);
  const [config, setConfig] = useState<Awaited<ReturnType<typeof fetchConfiguration>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(15);
  const [timelineDate, setTimelineDate] = useState<number | null>(null);
  const [timelineRange, setTimelineRange] = useState<readonly [number, number] | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => { setGravity(gravityUI); }, 300);
    return () => { clearTimeout(timer); };
  }, [gravityUI]);
  useEffect(() => {
    const timer = setTimeout(() => { setRepulsion(repulsionUI); }, 300);
    return () => { clearTimeout(timer); };
  }, [repulsionUI]);
  useEffect(() => {
    const timer = setTimeout(() => { setFriction(frictionUI); }, 300);
    return () => { clearTimeout(timer); };
  }, [frictionUI]);
  useEffect(() => {
    const timer = setTimeout(() => { setEdgeInfluence(edgeInfluenceUI); }, 300);
    return () => { clearTimeout(timer); };
  }, [edgeInfluenceUI]);

  const fetchGraphData = useCallback(async (isBackground = false): Promise<void> => {
    const startedAt = Date.now();
    if (!isBackground) {
      setLoadingProgress(15);
      setLoading(true);
    }
    try {
      const graph = await fetchVaultGraph();
      if (!isBackground) setLoadingProgress(70);
      setGraphData(graph);
    } catch (caught: unknown) {
      logError('graph-load', caught);
      setGraphData({
        edges: [],
        legend: { clusters: [], kinds: [] },
        nodes: [],
      });
    } finally {
      if (!isBackground) {
        setLoadingProgress(100);
        const delay = Math.max(
          0,
          MINIMUM_LOADING_DURATION_MS - (Date.now() - startedAt),
        );
        setTimeout(() => { setLoading(false); }, delay);
      }
    }
  }, []);

  const fetchConfigData = useCallback(async (): Promise<void> => {
    try {
      setConfig(await fetchConfiguration());
    } catch (caught: unknown) {
      logError('graph-config-load', caught);
    }
  }, []);

  useConfigChanged(() => { void fetchConfigData(); });

  useEffect(() => {
    void Promise.resolve().then(async () => {
      await Promise.all([
        fetchGraphData(),
        fetchConfigData(),
        fetchVaultTables()
          .then(setAvailableTables)
          .catch((caught: unknown) => { logError('graph-filter-tables', caught); }),
        fetchVaultGlobalIndex()
          .then(setIdTitleMap)
          .catch((caught: unknown) => { logError('graph-global-index', caught); }),
      ]);
    });
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDarkMode(root.classList.contains('dark'));
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    const node = new URLSearchParams(initialSearch.current).get('node');
    if (node) {
      setTimeout(() => {
        setSelectedNode(node);
        graphViewerRef.current?.panToNode(node, 2.5);
      }, 1500);
    }
    return () => { observer.disconnect(); };
  }, [fetchConfigData, fetchGraphData]);

  const settings = useMemo(() => graphSettingsFromDocument(config), [config]);
  useEffect(() => {
    if (!settings) return undefined;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const seeded = Boolean(settings.sources_initialized);
      setSourcesInitialized(seeded);
      if (settings.visible_databases) setVisibleDatabases([...settings.visible_databases]);
      if (settings.visible_tables) setVisibleTables([...settings.visible_tables]);
      if (settings.visible_fields) setVisibleFields([...settings.visible_fields]);
      if (settings.field_defaults) {
        setFieldFilters(Object.fromEntries(
          Object.entries(settings.field_defaults)
            .filter(([, value]) => Boolean(value))
            .map(([key, value]) => [key, new Set([value])]),
        ));
      }
      const tableFilters = settings.graph_table_filters?.length
        ? [...settings.graph_table_filters]
        : [...(settings.visible_tables ?? [])];
      setGraphTableFiltersSettings(tableFilters);
      const wikiVisible = seeded
        ? Boolean(settings.visible_databases?.includes('wiki'))
        : (!settings.visible_databases?.length
          || settings.visible_databases.includes('wiki'));
      setActiveTableFilters(new Set([
        ...(wikiVisible ? ['__wiki__'] : []),
        ...tableFilters,
      ]));
      if (settings.show_arrows !== undefined) setShowArrows(settings.show_arrows);
      if (settings.label_threshold) setLabelThreshold(settings.label_threshold);
      if (settings.node_size) setNodeSize(settings.node_size);
      if (settings.edge_thickness) setEdgeThickness(settings.edge_thickness);
      const physics = settings.physics;
      if (physics?.gravity !== undefined) {
        setGravityUI(physics.gravity); setGravity(physics.gravity);
      }
      if (physics?.repulsion !== undefined) {
        setRepulsionUI(physics.repulsion); setRepulsion(physics.repulsion);
      }
      if (physics?.friction !== undefined) {
        setFrictionUI(physics.friction); setFriction(physics.friction);
      }
      if (physics?.edge_influence !== undefined) {
        setEdgeInfluenceUI(physics.edge_influence); setEdgeInfluence(physics.edge_influence);
      }
      if (physics?.lin_log_mode !== undefined) setLinLogMode(physics.lin_log_mode);
      if (physics?.strong_gravity_mode !== undefined) {
        setStrongGravityMode(physics.strong_gravity_mode);
      }
      if (physics?.outbound_attraction_distribution !== undefined) {
        setOutboundAttractionDistribution(physics.outbound_attraction_distribution);
      }
    });
    return () => { active = false; };
  }, [settings]);

  useEffect(() => {
    if (!settings || settings.sources_initialized || !graphData?.nodes.length) return;
    const selection = deriveGraphSources(graphData.nodes);
    if (selection.databases.length === 0 && selection.tables.length === 0) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setVisibleDatabases(selection.databases);
      setVisibleTables(selection.tables);
      setSourcesInitialized(true);
      void updateConfiguration({
        graph: {
          sources_initialized: true,
          visible_databases: selection.databases,
          visible_tables: selection.tables,
        },
      })
        .then(() => {
          setConfig((current) => seedGraphConfigurationDocument(current, selection));
        })
        .catch((caught: unknown) => { logError('graph-source-seed', caught); });
    });
    return () => { active = false; };
  }, [graphData, settings]);

  const hasClusterData = useMemo(
    () => graphData?.nodes.some((node) => Boolean(node.cluster)) ?? false,
    [graphData],
  );
  useEffect(() => subscribeWindowEvent('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey)
      || !event.shiftKey
      || event.key.toLowerCase() !== 'c') return;
    event.preventDefault();
    setColorMode((current) => {
      const modes = hasClusterData ? ['kind', 'cluster'] : ['kind'];
      return modes[(modes.indexOf(current) + 1) % modes.length] ?? 'kind';
    });
  }), [hasClusterData]);

  const incomingTimelineRange = useMemo(() => deriveTimelineRange(graphData), [graphData]);
  useEffect(() => {
    if (!incomingTimelineRange) return;
    const maximum = incomingTimelineRange[1];
    queueMicrotask(() => {
      setTimelineRange(incomingTimelineRange);
      setTimelineDate((current) => current || maximum);
    });
  }, [incomingTimelineRange]);

  const memoizedGraph = useMemo(() => buildFilterGraph(graphData), [graphData]);
  const pathResult = useMemo(
    () => findShortestPath(graphInstance, pathSource, pathTarget),
    [graphInstance, pathSource, pathTarget],
  );
  const filters = useMemo(() => ({
    activeClusters,
    activeKinds,
    activeMediaTags,
    activeProjects,
    activeTableFilters,
    depth,
    fieldFilters,
    graphTableFiltersSettings,
    hideIsolated,
    onlyIsolated,
    pathResult,
    searchTerm,
    selectedNode,
    showSemanticSuggestions,
    sourcesInitialized,
    timelineDate,
    visibleDatabases,
    visibleTables,
  }), [activeClusters, activeKinds, activeMediaTags, activeProjects,
    activeTableFilters, depth, fieldFilters, graphTableFiltersSettings,
    hideIsolated, onlyIsolated, pathResult, searchTerm, selectedNode,
    showSemanticSuggestions, sourcesInitialized, timelineDate,
    visibleDatabases, visibleTables]);
  const graphCounts = useMemo(() => {
    if (!memoizedGraph) return { edges: 0, nodes: 0, types: {} };
    const { visibleEdges, visibleNodes } = applyFilters(memoizedGraph, filters);
    const suggestions = getVisibleSemanticEdges(
      graphData?.edges,
      visibleNodes,
      showSemanticSuggestions,
    );
    return {
      edges: visibleEdges.size,
      nodes: visibleNodes.size,
      types: getConnectionTypeCounts([
        ...[...visibleEdges].map((edge) => memoizedGraph.getEdgeAttributes(edge)),
        ...suggestions,
      ]),
    };
  }, [filters, graphData?.edges, memoizedGraph, showSemanticSuggestions]);

  const fieldValuesByKey = useMemo(
    () => deriveFieldValues(graphData, visibleFields),
    [graphData, visibleFields],
  );
  const idLabelResolver = useMemo(
    () => deriveIdLabels(graphData, idTitleMap),
    [graphData, idTitleMap],
  );
  const folderNameByTableId = useMemo(() => deriveFolderNames(graphData), [graphData]);
  const mediaTagsList = useMemo(() => deriveMediaTags(graphData), [graphData]);

  const handleSearchSubmit = useCallback((term: string): void => {
    if (!graphData || !term) return;
    const normalized = term.toLowerCase();
    const nodes = graphData.nodes;
    const match = nodes.find((node) => node.label.toLowerCase() === normalized)
      ?? nodes.find((node) => node.label.toLowerCase().startsWith(normalized))
      ?? nodes.find((node) => node.label.toLowerCase().includes(normalized));
    if (!match) return;
    const key = String(match.key);
    setSelectedNode(key);
    graphViewerRef.current?.panToNode(key, 2.5);
  }, [graphData]);

  const setHideIsolated = useCallback((checked: boolean): void => {
    setHideIsolatedState(checked);
    if (checked) setOnlyIsolatedState(false);
  }, []);
  const setOnlyIsolated = useCallback((checked: boolean): void => {
    setOnlyIsolatedState(checked);
    if (checked) setHideIsolatedState(false);
  }, []);
  const setIsPathfindingMode = useCallback((enabled: boolean): void => {
    setPathfindingModeState(enabled);
    if (!enabled) { setPathSource(null); setPathTarget(null); }
  }, []);
  const selectPathNode = useCallback((nodeId: string): void => {
    if (!pathSource) setPathSource(nodeId);
    else if (!pathTarget) setPathTarget(nodeId);
    else { setPathSource(nodeId); setPathTarget(null); }
  }, [pathSource, pathTarget]);
  const toggleSetValue = useCallback((
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    value: string,
  ): void => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  }, []);

  return {
    controller: {
      activeMediaTags, activeTableFilters, availableTables, colorMode, depth,
      displayFieldValue: (value: string) => displayGraphFieldValue(value, idLabelResolver),
      edgeInfluence, edgeInfluenceUI, edgeThickness, fetchGraphData,
      fieldFilters, fieldValuesByKey, filters, folderNameByTableId, friction,
      frictionUI, graphCounts, graphData, graphInstance, graphTableFiltersSettings,
      gravity, gravityUI, handleSearchSubmit, hasClusterData,
      hasSemanticData: hasSemanticSuggestions(graphData?.edges), hideIsolated,
      isDarkMode, isPathfindingMode, labelThreshold, linLogMode, loading,
      loadingProgress, mediaTagsList, nodeSize, onlyIsolated,
      outboundAttractionDistribution, pathResult, pathSource, pathTarget,
      rendererInstance, repulsion, repulsionUI, searchTerm, selectedNode,
      setActiveMediaTags, setActiveTableFilters, setColorMode, setDepth,
      setEdgeInfluenceUI, setEdgeThickness, setFieldFilters, setFrictionUI,
      setGraphInstance, setGravityUI, setHideIsolated, setIsPathfindingMode,
      setLabelThreshold, setLinLogMode, setNodeSize, setOnlyIsolated,
      setOutboundAttractionDistribution, setPathSource, setPathTarget,
      setRendererInstance, setRepulsionUI, setSearchTerm, setSelectedNode,
      setShowArrows, setShowSemanticSuggestions, setStrongGravityMode,
      setTimelineDate, showArrows, showSemanticSuggestions, sourcesInitialized,
      strongGravityMode, tableId, tableName, timelineDate, timelineRange,
      toggleSetValue, visibleDatabases, visibleFields, visibleTables,
      selectPathNode,
    },
    graphViewerRef,
  };
}


export type GraphPageController = ReturnType<
  typeof useGraphPageController
>['controller'];
