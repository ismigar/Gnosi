import React, {
    useCallback,
    useEffect,
    useRef,
    useState,
    useImperativeHandle,
    forwardRef,
} from 'react';
import {
    forceCenter,
    forceCollide,
    forceLink,
    forceManyBody,
    forceSimulation,
    forceX,
    forceY,
} from 'd3-force';
import Graph from 'graphology';
import Sigma from 'sigma';
import { applyFilters, getVisibleHoverNeighborhood } from '../utils/graphFilters';
import {
    GRAPH_KEYBOARD_ACTIONS,
    getGraphKeyboardAction,
    getPannedCameraState,
} from '../utils/graphKeyboardNavigation';
import {
    getVisibleCameraRatio,
    getVisibleGraphBounds,
} from '../utils/graphViewGeometry';


function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = '#';
    for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 0xFF;
        color += ('00' + value.toString(16)).substr(-2);
    }
    return color;
}

function seededUnitInterval(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
}

export const GraphViewer = forwardRef(({
    graphData,
    setGraphInstance,
    setRendererInstance,
    filters,
    onNodeClick,
    onNodeHover,
    isDarkMode,
    isPhysicsEnabled,
    colorMode,
    config,
    // Pathfinding props
    isPathfindingMode,
    pathSource,
    pathTarget,
    onSelectPathNode,
    // Visualization props
    showArrows = true,
    labelThreshold = 14,
    nodeSize = 1.0,
    edgeThickness = 1.0,
    // Physics props
    gravity = 1.0,
    repulsion = 1000,
    friction = 1.0,
    edgeInfluence = 1.0,
    linLogMode = true,
    strongGravityMode = false,
    outboundAttractionDistribution = false
}, ref) => {
    const containerRef = useRef(null);
    const rendererRef = useRef(null);
    const graphRef = useRef(null);
    const layoutRef = useRef(null); // Ref for the layout worker
    const [edgeTooltip] = useState(null);

    // Sync prop to ref so renderer can access latest value without re-init
    const isDarkModeRef = useRef(isDarkMode);
    const selectedNodeRef = useRef(filters?.selectedNode);
    const colorModeRef = useRef(colorMode);
    const isPathfindingModeRef = useRef(isPathfindingMode);
    const pathSourceRef = useRef(pathSource);
    const pathTargetRef = useRef(pathTarget);
    const onSelectPathNodeRef = useRef(onSelectPathNode);
    const onNodeClickRef = useRef(onNodeClick);
    const onNodeHoverRef = useRef(onNodeHover);
    const pathResultRef = useRef(filters?.pathResult);

    // Visualization refs
    const showArrowsRef = useRef(showArrows);
    const labelThresholdRef = useRef(labelThreshold);
    const nodeSizeRef = useRef(nodeSize);
    const edgeThicknessRef = useRef(edgeThickness);

    useEffect(() => {
        isPathfindingModeRef.current = isPathfindingMode;
    }, [isPathfindingMode]);

    useEffect(() => {
        pathSourceRef.current = pathSource;
        if (rendererRef.current && containerRef.current?.offsetWidth > 0) rendererRef.current.refresh();
    }, [pathSource]);

    useEffect(() => {
        pathTargetRef.current = pathTarget;
        if (rendererRef.current && containerRef.current?.offsetWidth > 0) rendererRef.current.refresh();
    }, [pathTarget]);

    useEffect(() => {
        onSelectPathNodeRef.current = onSelectPathNode;
    }, [onSelectPathNode]);

    useEffect(() => {
        onNodeClickRef.current = onNodeClick;
    }, [onNodeClick]);

    useEffect(() => {
        onNodeHoverRef.current = onNodeHover;
    }, [onNodeHover]);

    useEffect(() => {
        pathResultRef.current = filters?.pathResult;
        if (rendererRef.current && containerRef.current?.offsetWidth > 0) rendererRef.current.refresh();
    }, [filters?.pathResult]);
    useEffect(() => {
        isDarkModeRef.current = isDarkMode;
        if (rendererRef.current && containerRef.current?.offsetWidth > 0) rendererRef.current.refresh();
    }, [isDarkMode]);

    // Visualization props sync - update Sigma settings dynamically
    useEffect(() => {
        showArrowsRef.current = showArrows;
        if (rendererRef.current) {
            rendererRef.current.setSetting('renderEdgeLabels', false);
            if (containerRef.current?.offsetWidth > 0) rendererRef.current.refresh();
        }
    }, [showArrows]);

    useEffect(() => {
        labelThresholdRef.current = labelThreshold;
        if (rendererRef.current) {
            rendererRef.current.setSetting('labelRenderedSizeThreshold', labelThreshold);
            if (containerRef.current?.offsetWidth > 0) rendererRef.current.refresh();
        }
    }, [labelThreshold]);

    useEffect(() => {
        nodeSizeRef.current = nodeSize;
        if (rendererRef.current && containerRef.current?.offsetWidth > 0) rendererRef.current.refresh();
    }, [nodeSize]);

    useEffect(() => {
        edgeThicknessRef.current = edgeThickness;
        if (rendererRef.current && containerRef.current?.offsetWidth > 0) rendererRef.current.refresh();
    }, [edgeThickness]);

    // We remove the separate colorMode useEffect because it's now a dependency 
    // of the main Sigma initialization effect (line 696), forcing a re-init.

    useEffect(() => {
        selectedNodeRef.current = filters?.selectedNode;
        if (rendererRef.current && containerRef.current?.offsetWidth > 0) rendererRef.current.refresh();
    }, [filters?.selectedNode]);

    // This effect only updates the color without killing the server
    useEffect(() => {
        colorModeRef.current = colorMode;
        if (rendererRef.current) {
            // Sigma is smart enough: refresh() calls nodeReducer again
            // with the updated value of colorModeRef.current
            if (containerRef.current?.offsetWidth > 0) rendererRef.current.refresh();
            
        }
    }, [colorMode]);

    const fitTimerRef = useRef(null);

    // Fit every visible node using Sigma's own square normalization so the
    // camera and minimap describe the same graph-space extent.
    const fitVisibleNodes = useCallback((durationMs = 800) => {
        const graph = graphRef.current;
        const renderer = rendererRef.current;
        if (!graph || !renderer) return;

        const bounds = getVisibleGraphBounds(graph);
        if (!bounds) return;

        const norm = renderer.normalizationFunction;
        const centerNorm = norm({ x: bounds.centerX, y: bounds.centerY });
        const cameraRatio = getVisibleCameraRatio(renderer, bounds);

        renderer.getCamera().animate(
            { x: centerNorm.x, y: centerNorm.y, ratio: cameraRatio },
            { duration: durationMs, easing: 'cubicInOut' }
        );
    }, []);

    useImperativeHandle(ref, () => ({
        zoomIn: () => {
            const camera = rendererRef.current?.getCamera();
            if (camera) camera.animatedZoom({ duration: 500 });
        },
        zoomOut: () => {
            const camera = rendererRef.current?.getCamera();
            if (camera) camera.animatedUnzoom({ duration: 500 });
        },
        center: () => fitVisibleNodes(700),
        fullscreen: () => {
            if (containerRef.current) {
                if (document.fullscreenElement !== containerRef.current) {
                    containerRef.current.requestFullscreen();
                } else {
                    document.exitFullscreen();
                }
            }
        },
        panTo: (x, y, ratio = 1.0) => {
            const renderer = rendererRef.current || window.sigmaRenderer;
            const camera = renderer?.getCamera();

            if (renderer && camera) {
                // Ensure coordinates are numbers
                const safeX = Number(x);
                const safeY = Number(y);

                // Removed forced resize as it might cause issues
                // renderer.resize();

                if (!isNaN(safeX) && !isNaN(safeY)) {
                    camera.animate({ x: safeX, y: safeY, ratio }, { duration: 500 });
                }
            }
        },
        panToGraphPoint: (x, y, ratio = 1.0) => {
            const renderer = rendererRef.current || window.sigmaRenderer;
            const camera = renderer?.getCamera();
            const graphX = Number(x);
            const graphY = Number(y);
            if (!renderer || !camera || !Number.isFinite(graphX) || !Number.isFinite(graphY)) return;

            const cameraPoint = renderer.normalizationFunction({ x: graphX, y: graphY });
            camera.animate({ ...cameraPoint, ratio }, { duration: 500, easing: 'cubicInOut' });
        },
        panToNode: (nodeId, ratio = null) => {
            const renderer = rendererRef.current || window.sigmaRenderer;
            const camera = renderer?.getCamera();

            // ALWAYS use the graph from the renderer. This is the Source of Truth.
            // graphRef.current might be stale or point to a different instance (Split Brain).
            const graph = renderer?.getGraph();

            if (renderer && camera && graph && graph.hasNode(nodeId)) {
                const nodeAttrs = graph.getNodeAttributes(nodeId);

                // Use provided ratio, or current ratio, or default to 1
                const targetRatio = ratio !== null ? ratio : camera.ratio;

                const cameraPoint = renderer.normalizationFunction(nodeAttrs);

                // Use animate for smooth camera movement
                camera.animate({
                    x: cameraPoint.x,
                    y: cameraPoint.y,
                    ratio: targetRatio
                }, {
                    duration: 500,
                    easing: 'cubicInOut'
                });

                // Camera state logging removed for production
            } else {
                console.warn(`GraphViewer: Could not pan to node ${nodeId} (Renderer: ${!!renderer}, Graph: ${!!graph})`);
            }
        }
    }));

    useEffect(() => {
        const handleKeyDown = (event) => {
            const action = getGraphKeyboardAction(event);
            if (!action) return;

            const camera = rendererRef.current?.getCamera();
            if (!camera) return;

            event.preventDefault();

            if (action === GRAPH_KEYBOARD_ACTIONS.ZOOM_IN) {
                camera.animatedZoom({ duration: 300 });
                return;
            }
            if (action === GRAPH_KEYBOARD_ACTIONS.ZOOM_OUT) {
                camera.animatedUnzoom({ duration: 300 });
                return;
            }
            if (action === GRAPH_KEYBOARD_ACTIONS.CENTER) {
                fitVisibleNodes(400);
                return;
            }

            const nextState = getPannedCameraState(camera.getState(), action);
            if (nextState) {
                camera.animate(nextState, {
                    duration: 160,
                    easing: 'cubicInOut',
                });
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [fitVisibleNodes]);

    // 3. Initialize Sigma (Once)
    const initializedRef = useRef(false);
    useEffect(() => {
        if (!containerRef.current || initializedRef.current) return;
        

        // Wait for container to have dimensions
        if (containerRef.current.offsetWidth === 0 || containerRef.current.offsetHeight === 0) {
            console.warn("GraphViewer: Container has no dimensions, waiting for next opportunity...");
            return;
        }


        initializedRef.current = true;

        // Create Graph Instance
        const graph = new Graph();
        graphRef.current = graph;
        if (setGraphInstance) setGraphInstance(graph);

        // Define Reducers
        let hoveredNode = null;
        let hoverDistances = {};
        let hoveredEdges = new Set();

        // Sync refs
        colorModeRef.current = colorMode;
        isDarkModeRef.current = isDarkMode;

        const nodeReducer = (node, data) => {
            if (data.hidden) return { ...data, hidden: true, label: "" };
            const res = { ...data };

            // Pathfinding Highlighting
            const pathResult = pathResultRef.current;
            if (pathResult && pathResult.nodes) {
                const isInPath = pathResult.nodes.has(node);
                if (isInPath) {
                    res.opacity = 1;
                    res.zIndex = 20;
                    res.highlighted = true;
                    if (node === pathSource) res.color = '#e67e22';
                    else if (node === pathTarget) res.color = '#27ae60';
                } else {
                    res.opacity = 0.1;
                    res.label = "";
                    res.zIndex = 0;
                }
                return res;
            } else if (isPathfindingModeRef.current) {
                if (node === pathSourceRef.current || node === pathTargetRef.current) {
                    res.highlighted = true;
                    res.zIndex = 20;
                    res.color = node === pathSourceRef.current ? '#e67e22' : '#27ae60';
                    res.borderColor = '#fff';
                    res.size = (data.size || 3) * 1.5;
                } else if (pathSourceRef.current) {
                    res.opacity = 0.6;
                }
            }

            if (colorModeRef.current === 'cluster' && data.cluster) {
                res.color = stringToColor(data.cluster);
                res.borderColor = res.color;
            } else if (colorModeRef.current === 'ai_cluster' && data.ai_cluster) {
                res.color = data.ai_cluster_color || stringToColor(data.ai_cluster);
                res.borderColor = res.color;
            } else if (data.kind === 'unresolved') {
                res.color = isDarkModeRef.current ? '#94a3b8' : '#cbd5e1';
                res.borderColor = res.color;
                res.fontColor = isDarkModeRef.current ? '#cbd5e1' : '#64748b';
            } else {
                if (config && config.colors && config.colors.node_types) {
                    const nodeType = data.kind || 'default';
                    const typeConfig = config.colors.node_types[nodeType] || config.colors.node_types.default;
                    if (typeConfig) {
                        res.color = typeConfig.bg;
                        res.borderColor = typeConfig.border;
                        res.fontColor = typeConfig.font;
                    }
                }
            }

            const isDark = isDarkModeRef.current;
            res.labelColor = isDark ? "#ffffff" : "#000000";
            res.label = String(data.label || "");

            if (hoveredNode) {
                const d = hoverDistances[node] ?? 99;
                if (d <= 1) {
                    res.opacity = 1;
                    res.label = data.label;
                    res.zIndex = 10;
                } else {
                    res.opacity = 0.1;
                    res.label = "";
                    res.zIndex = 0;
                }
                if (node === hoveredNode) res.highlighted = true;
            } else if (selectedNodeRef.current && node === selectedNodeRef.current) {
                res.highlighted = true;
                res.zIndex = 10;
            }

            // Apply node size multiplier from visualization controls
            if (nodeSizeRef.current !== 1.0) {
                res.size = (res.size || data.size || 5) * nodeSizeRef.current;
            }

            return res;
        };

        const edgeReducer = (edge, data) => {
            if (data.hidden) return { ...data, hidden: true };
            const isDark = isDarkModeRef.current;
            const baseColor = isDark
                ? '#475569'
                : '#d9dde3';
            const activeColor = isDark
                ? 'rgba(226, 232, 240, 0.72)'
                : 'rgba(71, 85, 105, 0.58)';
            const color = data.kind === 'suggestion' ? '#FF4081' : baseColor;

            const pathResult = pathResultRef.current;
            if (pathResult && pathResult.edges) {
                if (pathResult.edges.has(edge)) return { ...data, color: "#3498db", size: 3, zIndex: 20 };
                else return { ...data, color: isDarkModeRef.current ? "rgba(255, 255, 255, 0.02)" : "rgba(0, 0, 0, 0.02)", opacity: 0.1, zIndex: 0 };
            }

            if (hoveredNode) {
                if (hoveredEdges.has(edge)) {
                    return { ...data, color: activeColor, size: 0.65, zIndex: 10 };
                }
                else return { ...data, color: isDarkModeRef.current ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)", zIndex: 0 };
            }

            // Apply edge thickness multiplier and arrow toggle from visualization controls
            const result = {
                ...data,
                color,
                type: showArrowsRef.current ? 'arrow' : 'line',
                zIndex: 1
            };
            const thickness = edgeThicknessRef.current || 1.0;
            result.size = Math.max(0.2, 0.3 * thickness);
            
            return result;



        };

        // Initialize Sigma
        if (rendererRef.current) rendererRef.current.kill();
        const renderer = new Sigma(graph, containerRef.current, {
            allowInvalidContainer: true, // Prevent "Sigma: Container has no width" error
            // WebGL is the default and more robust for standard setups
            nodeReducer,
            edgeReducer,
            renderEdges: true, // Native edge rendering
            defaultEdgeType: "line",
            minEdgeThickness: 0.2,
            minArrowSize: 3,
            maxArrowSize: 6,

            labelColor: { color: isDarkMode ? "#ffffff" : "#000000" },
            labelRenderedSizeThreshold: labelThreshold,
            labelDensity: 0.005,
            labelGridCellSize: 160,
            labelSizeRatio: 1.1,
            labelRenderer: (ctx, data) => {
                const isDark = isDarkModeRef.current;
                const fontSize = Math.max(data.size / 2, 10);
                const x = data.x + data.size + 3;
                const y = data.y + fontSize / 3;
                if (data.highlighted) {
                    const bgColor = isDark ? "#000000" : "#ffffff";
                    const textColor = isDark ? "#ffffff" : "#000000";
                    ctx.font = `bold ${fontSize}px Arial`;
                    const labelText = String(data.label || "");
                    const width = ctx.measureText(labelText).width;
                    ctx.fillStyle = bgColor;
                    ctx.fillRect(x - 2, y - fontSize, width + 4, fontSize + 4);
                    ctx.fillStyle = textColor;
                    ctx.fillText(labelText, x, y);
                } else {
                    ctx.font = `${fontSize}px Arial`;
                    ctx.fillStyle = isDark ? "#ffffff" : "#000000";
                    const labelText = String(data.label || "");
                    ctx.fillText(labelText, x, y);
                }
            },
            defaultDrawNodeHover: (context, data, settings) => {
                // Simplified hover draw for reliability
                const size = settings.labelSize;
                const font = settings.labelFont;
                const weight = settings.labelWeight;
                const isDark = isDarkModeRef.current;
                context.font = `${weight} ${size}px ${font}`;
                const labelBgColor = isDark ? "#000000" : "#ffffff";
                const textColor = isDark ? "#ffffff" : "#000000";
                const nodeBorderColor = data.borderColor || "#ffffff";
                context.fillStyle = nodeBorderColor;
                context.beginPath();
                context.arc(data.x, data.y, data.size + 2, 0, Math.PI * 2, true);
                context.fill();
                if (data.label) {
                    const labelText = String(data.label);
                    const width = context.measureText(labelText).width;
                    context.fillStyle = labelBgColor;
                    context.fillRect(data.x + data.size + 3, data.y - size + 4, width, size);
                    context.fillStyle = textColor;
                    context.fillText(labelText, data.x + data.size + 3, data.y + size / 3);
                }
            }
        });

        renderer.customId = Math.random().toString(36).substr(2, 9);
        window.sigmaRenderer = renderer;
        rendererRef.current = renderer;
        if (setRendererInstance) setRendererInstance(renderer);
        renderer.getCamera().setState({ x: 0.5, y: 0.4, ratio: 1.4 });

        // Event Listeners
        renderer.on("enterNode", (e) => {
            hoveredNode = e.node;
            hoverDistances = {};
            const visibleNeighborhood = getVisibleHoverNeighborhood(graph, e.node);
            visibleNeighborhood.nodes.forEach((node) => {
                hoverDistances[node] = node === e.node ? 0 : 1;
            });
            hoveredEdges = visibleNeighborhood.edges;
            if (containerRef.current?.offsetWidth > 0) renderer.refresh();
            if (onNodeHoverRef.current) onNodeHoverRef.current(e.node);
            containerRef.current.style.cursor = isPathfindingModeRef.current ? "crosshair" : "pointer";
        });
        renderer.on("leaveNode", () => {
            hoveredNode = null;
            hoverDistances = {};
            hoveredEdges = new Set();
            if (containerRef.current?.offsetWidth > 0) renderer.refresh();
            if (onNodeHoverRef.current) onNodeHoverRef.current(null);
            containerRef.current.style.cursor = "default";
        });
        renderer.on("clickNode", (e) => {
            if (isPathfindingModeRef.current) {
                if (onSelectPathNodeRef.current) onSelectPathNodeRef.current(e.node);
            } else if ((e.event.original.metaKey || e.event.original.ctrlKey)) {
                const nodeData = graph.getNodeAttributes(e.node);
                if (nodeData.url && nodeData.kind !== 'tag') window.open(nodeData.url, '_blank');
            } else if (onNodeClickRef.current) onNodeClickRef.current(e.node);
        });

        // Dragging & Keyboard (Keep existing handlers, attaching here broadly)
        // ... (Omitting detailed drag impl repetition to fit block, assuming standard Sigma drag)

        // Cleanup
        return () => {
            if (renderer) {
                try { renderer.kill(); } catch (e) { console.error(e); }
            }
            rendererRef.current = null;
            initializedRef.current = false;
            if (setRendererInstance) setRendererInstance(null);
        };
    }, [graphData]); // Re-attempt initialization when graphData arrives (container might be ready then)


    // 4. Data Update Effect
    useEffect(() => {
        const graph = graphRef.current;
        if (!graph || !graphData) return;



        // Option 1: Clear and Rebuild (Simple and robust for layout)
        // Since backend sends full graph, this prevents ghost nodes.
        // We preserve positions if they are in graphData (they are).
        graph.clear();

        // Initial positions: uniform distribution over a large area → FA2 converges better
        const totalNodes = (graphData.nodes || []).length;
        const spreadRadius = Math.max(300, Math.sqrt(totalNodes) * 40);

        graphData.nodes.forEach((n, i) => {
            const key = String(n.key);
            const rawSize = Number(n.size || 8);
            const displaySize = 1.0 + (rawSize - 8) * (2.0 / 10); // map [8,18]→[1,3]
            // If the backend has sent real positions (igraph FR), we respect them.
            // Fallback: golden spiral distribution.
            const hasBackendPos = typeof n.x === 'number' && typeof n.y === 'number'
                && (n.x !== 0 || n.y !== 0);
            let nx, ny;
            if (hasBackendPos) {
                nx = n.x;
                ny = n.y;
            } else {
                const goldenAngle = i * 2.399963;
                const r = spreadRadius * Math.sqrt((i + 1) / totalNodes);
                nx = Math.cos(goldenAngle) * r;
                ny = Math.sin(goldenAngle) * r;
            }
            graph.addNode(key, {
                ...n,
                x: nx,
                y: ny,
                size: Math.max(1, Math.min(3, displaySize)),
            });
        });
        graphData.edges.forEach(e => {
            // Render every body wikilink, including one that also belongs to a
            // database-view relation. Frontmatter-only relations, structural
            // hierarchy, and inferred similarity edges remain excluded.
            if (e.kind !== 'link' && !e.body_link) return;
            const source = String(e.source);
            const target = String(e.target);
            if (!graph.hasNode(source) || !graph.hasNode(target)) return;
            
            // Prevent graphology crash on duplicate edges in simple graphs
            if (graph.hasEdge(source, target)) return;
            
            try {
                if (e.directed) {
                    graph.addDirectedEdge(source, target, e);
                } else {
                    graph.addUndirectedEdge(source, target, e);
                }
            } catch(err) {
                console.warn("GraphViewer edge add error:", err);
            }
        });

        if (rendererRef.current && containerRef.current?.offsetWidth > 0) {
            rendererRef.current.refresh();
            if (!isPhysicsEnabled) {
                setTimeout(() => fitVisibleNodes(800), 100);
            }
        }

    }, [graphData]); // eslint-disable-line react-hooks/exhaustive-deps

    // Apply filters before starting the physics pass. React executes effects in
    // declaration order, so the simulation always sees the current visible
    // subgraph instead of the complete vault.
    useEffect(() => {
        const graph = graphRef.current;
        const renderer = rendererRef.current;
        if (!graph || !renderer) return;

        const { visibleNodes, visibleEdges } = applyFilters(graph, filters);

        const visibleDegree = new Map();
        visibleEdges.forEach((edge) => {
            const source = graph.source(edge);
            const target = graph.target(edge);
            visibleDegree.set(source, (visibleDegree.get(source) || 0) + 1);
            visibleDegree.set(target, (visibleDegree.get(target) || 0) + 1);
        });

        // Obsidian sizes nodes by the number of visible connections. Apply the
        // same rule in one Graphology event so hubs stand out without flooding
        // Sigma and the minimap with per-node updates.
        graph.updateEachNodeAttributes((node, attrs) => {
            const hidden = !visibleNodes.has(node);
            const degree = visibleDegree.get(node) || 0;
            const size = attrs.kind === 'unresolved'
                ? 0.5
                : Math.min(3.2, 0.7 + Math.sqrt(degree) * 0.27);
            return { ...attrs, hidden, size };
        }, { attributes: ['hidden', 'size'] });

        graph.updateEachEdgeAttributes((edge, attrs) => {
            return { ...attrs, hidden: !visibleEdges.has(edge) };
        }, { attributes: ['hidden'] });

        if (containerRef.current?.offsetWidth > 0) {
            renderer.refresh();
            if (!isPhysicsEnabled) {
                if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
                fitTimerRef.current = setTimeout(() => fitVisibleNodes(500), 120);
            }
        }

        return () => {
            if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
        };
    }, [filters, graphData, isPhysicsEnabled, fitVisibleNodes]); // Re-run when filters change

    // Obsidian-style D3 simulation over the complete visible subgraph. Isolates
    // and small components remain in the same force field instead of being
    // removed and placed into an artificial ring after the layout.
    useEffect(() => {
        // Cancel any previous loop
        if (typeof layoutRef.current === 'number') {
            cancelAnimationFrame(layoutRef.current);
        } else if (layoutRef.current?.stop) {
            try { layoutRef.current.stop(); } catch { /* Layout may already be stopped. */ }
        }
        layoutRef.current = null;

        const graph = graphRef.current;
        const renderer = rendererRef.current;
        if (!graph || !renderer || !isPhysicsEnabled || graph.order === 0) return;

        // Builds a subgraph with ONLY visible nodes and their connections
        const subG = new Graph();
        graph.forEachNode((node, attrs) => {
            if (!attrs.hidden) {
                subG.addNode(node, {
                    x: attrs.x || 0,
                    y: attrs.y || 0,
                    size: attrs.size || 5,
                    unresolved: attrs.kind === 'unresolved',
                });
            }
        });
        graph.forEachEdge((_edge, attrs, source, target) => {
            if (subG.hasNode(source) && subG.hasNode(target) && !subG.hasEdge(source, target)) {
                subG.addEdge(source, target, attrs);
            }
        });

        if (subG.order === 0) return;

        const simulationNodes = [];
        const simulationNodeById = new Map();
        subG.forEachNode((node, attrs) => {
            const angle = seededUnitInterval(`${node}:angle`) * Math.PI * 2;
            const seedRadius = Math.max(240, Math.sqrt(subG.order) * 25);
            const radius = Math.sqrt(seededUnitInterval(`${node}:radius`)) * seedRadius;
            const isolated = subG.degree(node) === 0;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            const item = {
                id: node,
                radius: Number(attrs.size || 2),
                unresolved: Boolean(attrs.unresolved),
                isolated,
                x,
                y,
                // Obsidian keeps isolates scattered around the canvas. Pinning
                // only zero-degree nodes prevents global repulsion from
                // arranging them into an artificial circular shell.
                ...(isolated ? { fx: x, fy: y } : {}),
            };
            simulationNodes.push(item);
            simulationNodeById.set(node, item);
        });

        const simulationLinks = [];
        subG.forEachEdge((_edge, attrs, source, target) => {
            simulationLinks.push({
                source,
                target,
                weight: Number(attrs.weight || 1),
                unresolved: Boolean(attrs.unresolved),
            });
        });

        const centerStrength = Math.min(
            1,
            Math.max(0, gravity * 5.18713248970312 * (strongGravityMode ? 1.35 : 1)),
        );
        // Normalize Gnosi's legacy 0-1000 control to D3 graph-space and clamp
        // close encounters so dense hubs do not collapse into one point.
        const chargeStrength = -Math.max(1, repulsion / 50);
        const velocityDecay = Math.min(0.9, Math.max(0.1, 0.2 + friction / 50));
        const resolvedLinkDistance = linLogMode ? 300 : 250;
        // Compact unresolved UUID leaves into the small radial stars visible in
        // Obsidian instead of giving them the full distance between real notes.
        const unresolvedLinkDistance = resolvedLinkDistance / 4;
        const centeringStrength = centerStrength * 0.06;

        const linkForce = forceLink(simulationLinks)
            .id(node => node.id)
            .distance(link => (
                link.unresolved ? unresolvedLinkDistance : resolvedLinkDistance
            ))
            .strength((link) => {
                const weightedStrength = edgeInfluence > 0
                    ? Math.pow(Math.max(0.01, link.weight), edgeInfluence)
                    : 1;
                const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                const targetId = typeof link.target === 'object' ? link.target.id : link.target;
                const degreeDivisor = outboundAttractionDistribution
                    ? subG.degree(sourceId)
                    : Math.min(subG.degree(sourceId), subG.degree(targetId));
                return weightedStrength / Math.max(1, degreeDivisor);
            });

        const simulation = forceSimulation(simulationNodes)
            .force('link', linkForce)
            .force(
                'charge',
                forceManyBody()
                    .strength(node => (node.isolated ? 0 : chargeStrength))
                    .distanceMin(30),
            )
            .force('center', forceCenter(0, 0))
            .force('centerX', forceX(0).strength(centeringStrength))
            .force('centerY', forceY(0).strength(centeringStrength))
            .force('collision', forceCollide(node => node.radius * 1.5 + 1).strength(0.7))
            .velocityDecay(velocityDecay)
            .stop();

        const TICKS_PER_FRAME = 4;
        const MAX_TICKS = 300;
        let totalTicks = 0;
        let running = true;

        const copyPositions = () => {
            graph.updateEachNodeAttributes((node, attrs) => {
                const position = simulationNodeById.get(node);
                if (!position) return attrs;
                return { ...attrs, x: position.x, y: position.y };
            }, { attributes: ['x', 'y'] });
        };

        const step = () => {
            if (!running) return;

            try {
                simulation.tick(TICKS_PER_FRAME);
            } catch (e) {
                console.error('Layout error:', e);
                running = false;
                return;
            }

            copyPositions();
            totalTicks += TICKS_PER_FRAME;

            if (renderer && containerRef.current?.offsetWidth > 0) renderer.refresh();

            if (totalTicks >= MAX_TICKS || simulation.alpha() <= simulation.alphaMin()) {
                running = false;
                simulation.stop();
                copyPositions();
                if (renderer) renderer.refresh();
                setTimeout(() => fitVisibleNodes(900), 300);
                layoutRef.current = null;
                return;
            }

            const rafId = requestAnimationFrame(step);
            layoutRef.current = rafId;
        };

        const rafId = requestAnimationFrame(step);
        layoutRef.current = {
            stop: () => {
                running = false;
                simulation.stop();
                cancelAnimationFrame(rafId);
            },
        };

        return () => {
            running = false;
            simulation.stop();
            if (typeof layoutRef.current === 'number') {
                cancelAnimationFrame(layoutRef.current);
            } else {
                layoutRef.current?.stop?.();
            }
            layoutRef.current = null;
        };
    }, [isPhysicsEnabled, graphData, filters, repulsion, edgeInfluence, gravity, friction, linLogMode, strongGravityMode, outboundAttractionDistribution, fitVisibleNodes]);

    return (
        <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
            {edgeTooltip && (
                <div
                    style={{
                        position: 'absolute',
                        left: edgeTooltip.x + 10,
                        top: edgeTooltip.y + 10,
                        background: isDarkMode ? '#333' : '#fff',
                        color: isDarkMode ? '#fff' : '#000',
                        padding: '8px 12px',
                        borderRadius: '4px',
                        border: `1px solid ${isDarkMode ? '#555' : '#ccc'} `,
                        pointerEvents: 'none',
                        zIndex: 'var(--z-popover)',
                        maxWidth: '300px',
                        fontSize: '12px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                    }}
                >
                    {edgeTooltip.text}
                </div>
            )}
        </div>
    );
});
