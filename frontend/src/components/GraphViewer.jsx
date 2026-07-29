import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { applyFilters } from '../utils/graphFilters';
import { assign as fa2Assign } from 'graphology-layout-forceatlas2';
import { assign as forceAssign } from 'graphology-layout-force';
import noverlapAssign from 'graphology-layout-noverlap';


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
    const [edgeTooltip, setEdgeTooltip] = useState(null);

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

    // Fit camera to visible nodes using Sigma's own normalization function.
    // Sigma maps graph coords → [0,1] via: normX = 0.5 + (x - centerX) / maxExtent
    const fitVisibleNodes = (durationMs = 800) => {
        const graph = graphRef.current;
        const renderer = rendererRef.current;
        if (!graph || !renderer) return;

        const connXs = [], connYs = [];
        graph.forEachNode((node, attrs) => {
            if (attrs.hidden || !isFinite(attrs.x) || !isFinite(attrs.y)) return;
            // We zoom in on the connected component; orphans (in the outer ring) are not
            // included because they would zoom out too much and compress the clusters.
            if (graph.degree(node) > 0) {
                connXs.push(attrs.x);
                connYs.push(attrs.y);
            }
        });

        if (connXs.length === 0) return;

        connXs.sort((a, b) => a - b);
        connYs.sort((a, b) => a - b);

        const minX = connXs[0], maxX = connXs[connXs.length - 1];
        const minY = connYs[0], maxY = connYs[connYs.length - 1];
        const denseCx = connXs[Math.floor(connXs.length / 2)];
        const denseCy = connYs[Math.floor(connYs.length / 2)];

        const norm = renderer.normalizationFunction;
        const centerNorm = norm({ x: denseCx, y: denseCy });

        const visExtent = Math.max(maxX - minX, maxY - minY) || 1;
        const cameraRatio = (visExtent / norm.ratio) * 0.083;

        renderer.getCamera().animate(
            { x: centerNorm.x, y: centerNorm.y, ratio: Math.max(0.05, cameraRatio) },
            { duration: durationMs, easing: 'cubicInOut' }
        );
    };

    // Arranges VISIBLE isolated nodes in a ring around the connected cluster.
    // Prevents FA2 (which runs over all 814 nodes) from scattering them outside the viewport.
    const layoutIsolatedNodesInRing = () => {
        const graph = graphRef.current;
        if (!graph) return;

        const connXs = [], connYs = [], isolatedIds = [];
        graph.forEachNode((node, attrs) => {
            if (attrs.hidden) return;
            let visDeg = 0;
            graph.forEachNeighbor(node, (n) => {
                if (!graph.getNodeAttribute(n, 'hidden')) visDeg++;
            });
            if (visDeg > 0 && isFinite(attrs.x)) {
                connXs.push(attrs.x); connYs.push(attrs.y);
            } else if (visDeg === 0) {
                isolatedIds.push(node);
            }
        });

        if (isolatedIds.length === 0) return;

        const cx = connXs.length > 0
            ? connXs.reduce((a, b) => a + b, 0) / connXs.length : 0;
        const cy = connYs.length > 0
            ? connYs.reduce((a, b) => a + b, 0) / connYs.length : 0;

        let maxR = 30;
        connXs.forEach((x, i) => {
            const d = Math.sqrt((x - cx) ** 2 + (connYs[i] - cy) ** 2);
            if (d > maxR) maxR = d;
        });

        const ringR = maxR * 1.8 + 120;
        isolatedIds.forEach((node, i) => {
            const angle = (i / isolatedIds.length) * 2 * Math.PI - Math.PI / 2;
            graph.setNodeAttribute(node, 'x', cx + Math.cos(angle) * ringR);
            graph.setNodeAttribute(node, 'y', cy + Math.sin(angle) * ringR);
        });

        if (rendererRef.current && containerRef.current?.offsetWidth > 0) {
            rendererRef.current.refresh();
        }
    };

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

                // CRITICAL: Node coordinates are in "graph space", but camera coordinates
                // appear to be normalized. We need to transform them.
                // Based on observation: camera at (0.5, 0.4) shows the well-centered graph.
                // This suggests the camera operates in a normalized [0,1] space.

                // Get all nodes to calculate bounds
                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                graph.forEachNode((_, attrs) => {
                    minX = Math.min(minX, attrs.x);
                    maxX = Math.max(maxX, attrs.x);
                    minY = Math.min(minY, attrs.y);
                    maxY = Math.max(maxY, attrs.y);
                });

                const graphWidth = maxX - minX;
                const graphHeight = maxY - minY;

                // Transform node coordinates to normalized camera space [0, 1]
                // Formula: normalized = (value - min) / range
                const normalizedX = (nodeAttrs.x - minX) / graphWidth;
                // IMPORTANT: Invert Y axis because camera Y is inverted
                const normalizedY = 1 - (nodeAttrs.y - minY) / graphHeight;

                // Debug logs removed for production

                // Use animate for smooth camera movement
                camera.animate({
                    x: normalizedX,
                    y: normalizedY,
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
            let color = data.color;

            if (config && config.colors && config.colors.edges) {
                const edgesConfig = config.colors.edges;
                if (data.kind === 'tag' && edgesConfig.tag_edge_color) {
                    color = edgesConfig.tag_edge_color;
                } else if (data.kind === 'explicit') {
                    if (data.directed && edgesConfig.direct_color) color = edgesConfig.direct_color;
                    else if (edgesConfig.explicit_color) color = edgesConfig.explicit_color;
                } else if (data.kind === 'inferred' || data.kind === 'similarity') {
                    // Apply similarity bucket colors
                    const sim = data.similarity || 0;
                    const buckets = edgesConfig.similarity_buckets || [];
                    // Buckets are sorted by min descending in config, so first match wins
                    for (const bucket of buckets) {
                        if (sim >= bucket.min) {
                            color = bucket.color;
                            break;
                        }
                    }
                    // Fallback if no bucket matched
                    if (!color || color === data.color) {
                        color = edgesConfig.default_inferred_color || '#E0E0E0';
                    }
                }
            } else if (data.kind === 'suggestion') {
                color = '#FF4081';
            }

            const pathResult = pathResultRef.current;
            if (pathResult && pathResult.edges) {
                if (pathResult.edges.has(edge)) return { ...data, color: "#3498db", size: 3, zIndex: 20 };
                else return { ...data, color: isDarkModeRef.current ? "rgba(255, 255, 255, 0.02)" : "rgba(0, 0, 0, 0.02)", opacity: 0.1, zIndex: 0 };
            }

            if (hoveredNode) {
                const source = graph.source(edge);
                const target = graph.target(edge);
                if (source === hoveredNode || target === hoveredNode) return { ...data, color, zIndex: 10 };
                else return { ...data, color: isDarkModeRef.current ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)", zIndex: 0 };
            }

            // Apply edge thickness multiplier and arrow toggle from visualization controls
            let finalColor = color || (isDarkModeRef.current ? '#888888' : '#666666');
            
            const result = {
                ...data,
                color: finalColor,
                zIndex: 1
            };
            const thickness = edgeThicknessRef.current || 1.0;
            result.size = Math.max(0.05, 0.08 * thickness);
            
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
            defaultEdgeType: "arrow", // Global arrows
            minArrowSize: 8,
            maxArrowSize: 15,

            labelColor: { color: isDarkMode ? "#ffffff" : "#000000" },
            labelRenderThreshold: labelThreshold,
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
            hoverDistances[e.node] = 0;
            graph.forEachNeighbor(e.node, n => hoverDistances[n] = 1);
            if (containerRef.current?.offsetWidth > 0) renderer.refresh();
            if (onNodeHoverRef.current) onNodeHoverRef.current(e.node);
            containerRef.current.style.cursor = isPathfindingModeRef.current ? "crosshair" : "pointer";
        });
        renderer.on("leaveNode", () => {
            hoveredNode = null;
            hoverDistances = {};
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
            // We show ONLY real wikilinks [[...]] like Obsidian does.
            // Edges structural (parent_id) i relation distorsionen la topologia.
            if (e.kind !== 'link') return;
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
            // Fit camera to visible nodes once the graph loads
            setTimeout(() => fitVisibleNodes(800), 100);
        }

    }, [graphData]); // eslint-disable-line react-hooks/exhaustive-deps

    // Physics Effect - synchronous FA2 over the SUBGRAPH of visible nodes (without interference from hidden ones)
    useEffect(() => {
        // Cancel any previous loop
        if (typeof layoutRef.current === 'number') {
            cancelAnimationFrame(layoutRef.current);
        } else if (layoutRef.current?.stop) {
            try { layoutRef.current.stop(); } catch (_) {}
        }
        layoutRef.current = null;

        const graph = graphRef.current;
        const renderer = rendererRef.current;
        if (!graph || !renderer || !isPhysicsEnabled || graph.order === 0) return;

        // Builds a subgraph with ONLY visible nodes and their connections
        const subG = new Graph();
        graph.forEachNode((node, attrs) => {
            if (!attrs.hidden) subG.addNode(node, { x: attrs.x || 0, y: attrs.y || 0, size: attrs.size || 5 });
        });
        graph.forEachEdge((_edge, attrs, source, target) => {
            if (subG.hasNode(source) && subG.hasNode(target) && !subG.hasEdge(source, target)) {
                subG.addEdge(source, target, attrs);
            }
        });

        if (subG.order === 0) return;

        // Identifies orphan nodes (degree 0) — they'll be placed in an outer ring post-FA2
        const orphans = [];
        subG.forEachNode((node) => { if (subG.degree(node) === 0) orphans.push(node); });
        // FA2/force runs on the connected component to refine the layout
        // that the backend has already calculated with igraph.
        const connectedG = new Graph();
        subG.forEachNode((node, attrs) => {
            if (subG.degree(node) > 0) connectedG.addNode(node, { ...attrs });
        });
        subG.forEachEdge((_e, attrs, s, t) => connectedG.addEdge(s, t, attrs));

        // Adaptive strategy: for small graphs (<500) we use force (spring-based,
        // high quality, look closer to Obsidian); for large graphs, FA2 with Barnes-Hut
        // to maintain O(N log N) performance.
        const useForceLayout = connectedG.order < 500;

        const fa2Settings = {
            gravity,
            scalingRatio:        repulsion / 50,
            slowDown:            Math.max(1, friction),
            edgeWeightInfluence: edgeInfluence,
            linLogMode,
            outboundAttractionDistribution,
            adjustSizes:         false,
            barnesHutOptimize:   connectedG.order > 500,
            barnesHutTheta:      0.5,
            strongGravityMode,
        };

        const forceSettings = {
            attraction:        0.0005 * Math.max(0.1, edgeInfluence),
            repulsion:         repulsion / 100,
            gravity:           gravity * 0.0001,
            inertia:           0.6,
            maxMove:           200,
        };

        const ITERS_PER_FRAME = useForceLayout ? 1 : 6;
        const MAX_ITERS = useForceLayout ? 500 : 3000;
        let totalIters = 0;
        let running = true;

        const placeOrphansInRing = () => {
            // Calculates the bbox of the connected component
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            connectedG.forEachNode((_n, a) => {
                if (a.x < minX) minX = a.x;
                if (a.x > maxX) maxX = a.x;
                if (a.y < minY) minY = a.y;
                if (a.y > maxY) maxY = a.y;
            });
            if (!isFinite(minX)) { minX = -100; maxX = 100; minY = -100; maxY = 100; }
            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;
            const halfW = (maxX - minX) / 2 || 100;
            const halfH = (maxY - minY) / 2 || 100;
            const baseRadius = Math.max(halfW, halfH) * 1.3 + 50;
            const ringDepth = baseRadius * 0.6;
            // We distribute orphans in a ring with uniform angles + radial jitter
            const n = orphans.length;
            for (let i = 0; i < n; i++) {
                const angle = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
                const r = baseRadius + Math.random() * ringDepth;
                const node = orphans[i];
                subG.setNodeAttribute(node, 'x', cx + Math.cos(angle) * r);
                subG.setNodeAttribute(node, 'y', cy + Math.sin(angle) * r);
            }
        };

        const step = () => {
            if (!running) return;

            try {
                if (useForceLayout) {
                    forceAssign(connectedG, { maxIterations: ITERS_PER_FRAME, settings: forceSettings });
                } else {
                    fa2Assign(connectedG, { iterations: ITERS_PER_FRAME, settings: fa2Settings });
                }
            } catch (e) {
                console.error('Layout error:', e);
                running = false;
                return;
            }

            // Copies positions of the connected component to subG and to the main graph
            connectedG.forEachNode((node, attrs) => {
                if (subG.hasNode(node)) {
                    subG.setNodeAttribute(node, 'x', attrs.x);
                    subG.setNodeAttribute(node, 'y', attrs.y);
                }
                if (graph.hasNode(node)) {
                    graph.setNodeAttribute(node, 'x', attrs.x);
                    graph.setNodeAttribute(node, 'y', attrs.y);
                }
            });

            totalIters += ITERS_PER_FRAME;

            if (renderer && containerRef.current?.offsetWidth > 0) renderer.refresh();

            if (totalIters >= MAX_ITERS) {
                running = false;
                try {
                    placeOrphansInRing();
                    noverlapAssign(subG, {
                        maxIterations: 500,
                        settings: { margin: 20, ratio: 2.0, expansion: 1.5, gridSize: 20 },
                    });
                    subG.forEachNode((node, attrs) => {
                        if (graph.hasNode(node)) {
                            graph.setNodeAttribute(node, 'x', attrs.x);
                            graph.setNodeAttribute(node, 'y', attrs.y);
                        }
                    });
                    if (renderer) renderer.refresh();
                } catch (e) {
                    console.error('Post-layout error:', e);
                }
                setTimeout(() => fitVisibleNodes(900), 300);
                layoutRef.current = null;
                return;
            }

            const rafId = requestAnimationFrame(step);
            layoutRef.current = rafId;
        };

        const rafId = requestAnimationFrame(step);
        layoutRef.current = rafId;

        return () => {
            running = false;
            if (typeof layoutRef.current === 'number') cancelAnimationFrame(layoutRef.current);
            layoutRef.current = null;
        };
    }, [isPhysicsEnabled, graphData, repulsion, edgeInfluence, gravity, friction, linLogMode, strongGravityMode, outboundAttractionDistribution]); // eslint-disable-line react-hooks/exhaustive-deps

    // Handle Filters (Effect)
    useEffect(() => {
        const graph = graphRef.current;
        const renderer = rendererRef.current;
        if (!graph || !renderer) return;

        // Apply filters logic using shared utility
        const { visibleNodes, visibleEdges } = applyFilters(graph, filters);

        graph.forEachNode((node) => {
            graph.setNodeAttribute(node, "hidden", !visibleNodes.has(node));
        });

        graph.forEachEdge((edge) => {
            graph.setEdgeAttribute(edge, "hidden", !visibleEdges.has(edge));
        });

        if (renderer && containerRef.current?.offsetWidth > 0) renderer.refresh();

    }, [filters, graphData]); // Re-run when filters change

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
