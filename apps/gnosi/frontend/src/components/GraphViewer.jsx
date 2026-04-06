import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { applyFilters } from '../utils/graphFilters';
import ForceAtlas2 from 'graphology-layout-forceatlas2/worker';


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
    gravity = 0.2,     // Default low gravity
    repulsion = 1500,  // Default high repulsion
    friction = 10,      // Default stable friction 
    edgeInfluence = 0,
    linLogMode = false
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
        if (rendererRef.current) rendererRef.current.refresh();
    }, [pathSource]);

    useEffect(() => {
        pathTargetRef.current = pathTarget;
        if (rendererRef.current) rendererRef.current.refresh();
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
        if (rendererRef.current) rendererRef.current.refresh();
    }, [filters?.pathResult]);
    useEffect(() => {
        isDarkModeRef.current = isDarkMode;
        if (rendererRef.current) rendererRef.current.refresh();
    }, [isDarkMode]);

    // Visualization props sync - update Sigma settings dynamically
    useEffect(() => {
        showArrowsRef.current = showArrows;
        if (rendererRef.current) {
            rendererRef.current.setSetting('renderEdgeLabels', false);
            rendererRef.current.refresh();
        }
    }, [showArrows]);

    useEffect(() => {
        labelThresholdRef.current = labelThreshold;
        if (rendererRef.current) {
            rendererRef.current.setSetting('labelRenderedSizeThreshold', labelThreshold);
            rendererRef.current.refresh();
        }
    }, [labelThreshold]);

    useEffect(() => {
        nodeSizeRef.current = nodeSize;
        if (rendererRef.current) rendererRef.current.refresh();
    }, [nodeSize]);

    useEffect(() => {
        edgeThicknessRef.current = edgeThickness;
        if (rendererRef.current) rendererRef.current.refresh();
    }, [edgeThickness]);

    // We remove the separate colorMode useEffect because it's now a dependency 
    // of the main Sigma initialization effect (line 696), forcing a re-init.

    useEffect(() => {
        selectedNodeRef.current = filters?.selectedNode;
        if (rendererRef.current) rendererRef.current.refresh();
    }, [filters?.selectedNode]);

    // Aquest efecte només actualitza el color sense matar el servidor
    useEffect(() => {
        colorModeRef.current = colorMode;
        if (rendererRef.current) {
            // Sigma és prou intel·ligent: refresh() torna a cridar al nodeReducer
            // amb el valor actualitzat de colorModeRef.current
            rendererRef.current.refresh();
            console.log("GraphViewer: ColorMode actualitzat a", colorMode);
        }
    }, [colorMode]);

    useImperativeHandle(ref, () => ({
        zoomIn: () => {
            const camera = rendererRef.current?.getCamera();
            if (camera) camera.animatedZoom({ duration: 500 });
        },
        zoomOut: () => {
            const camera = rendererRef.current?.getCamera();
            if (camera) camera.animatedUnzoom({ duration: 500 });
        },
        center: () => {
            const camera = rendererRef.current?.getCamera();
            // Use the well-centered view that shows the full graph properly
            if (camera) camera.animate({ x: 0.5, y: 0.4, ratio: 1.4 }, { duration: 700 });
        },
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
        console.log("GraphViewer: Attempting to initialize Sigma");

        // Wait for container to have dimensions
        if (containerRef.current.offsetWidth === 0 || containerRef.current.offsetHeight === 0) {
            console.warn("GraphViewer: Container has no dimensions, waiting for next opportunity...");
            return;
        }

        console.log("GraphViewer: Initializing Sigma (Success)");
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
            
            // Ensure a robust base visible size for edges in WebGL mode
            const baseSize = data.size || 2.0; 
            const result = { 
                ...data, 
                color: finalColor,
                zIndex: 1
            };
            
            const thickness = edgeThicknessRef.current || 1.0;
            result.size = Math.max(1.0, baseSize * thickness);
            
            return result;



        };

        // Initialize Sigma
        if (rendererRef.current) rendererRef.current.kill();
        const renderer = new Sigma(graph, containerRef.current, {
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
            renderer.refresh();
            if (onNodeHoverRef.current) onNodeHoverRef.current(e.node);
            containerRef.current.style.cursor = isPathfindingModeRef.current ? "crosshair" : "pointer";
        });
        renderer.on("leaveNode", () => {
            hoveredNode = null;
            hoverDistances = {};
            renderer.refresh();
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

        console.log("GraphViewer: Updating Graph Data (Nodes:", graphData.nodes.length, ")");

        // Option 1: Clear and Rebuild (Simple and robust for layout)
        // Since backend sends full graph, this prevents ghost nodes.
        // We preserve positions if they are in graphData (they are).
        graph.clear();

        graphData.nodes.forEach(n => {
            // NORMALIZE positions from backend range (-2000 to 2000) to smaller range (-500 to 500)
            // This allows the custom physics simulation to properly apply forces
            // Backend spring_layout positions are preserved but scaled down
            const rawX = Number(n.x) || Math.random() * 100 - 50;
            const rawY = Number(n.y) || Math.random() * 100 - 50;
            graph.addNode(String(n.key), {
                ...n,
                x: rawX * 0.25,  // Scale from ~2000 range to ~500 range
                y: rawY * 0.25,
                size: Number(n.size || 3)
            });
        });
        graphData.edges.forEach(e => {
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

        // If physics was running, it might need a kick, but forceAtlas usually monitors graph events?
        // Actually forceAtlas worker might need restart if graph cleared? 
        // We have a separate physics effect for that.

        if (rendererRef.current) rendererRef.current.refresh();

    }, [graphData]);

    // Physics Effect - Custom D3-like Force Simulation (Connected to UI)
    useEffect(() => {
        const graph = graphRef.current;
        const renderer = rendererRef.current;
        if (!graph || !renderer || !isPhysicsEnabled) {
            if (layoutRef.current) {
                cancelAnimationFrame(layoutRef.current);
                layoutRef.current = null;
            }
            return;
        }

        // Use UI slider values! Tuned for position range ~-500 to 500
        const REPULSION_STRENGTH = repulsion * 0.5; // Reduced multiplier for smaller position range
        const EDGE_ATTRACTION = edgeInfluence * 0.0005;  // Linear: higher slider = more attraction
        const GRAVITY_STRENGTH = gravity * 10; // Pull toward center
        const DAMPING = 0.92; // Higher damping for stability
        const MIN_DISTANCE = 5;  // Smaller minimum for dense graphs

        console.log(`D3Sim: Rep=${REPULSION_STRENGTH.toFixed(0)}, EdgeAttr=${EDGE_ATTRACTION.toFixed(5)}, Grav=${GRAVITY_STRENGTH.toFixed(2)}, Nodes=${graphRef.current?.order || 0}`);

        // Calculate center of mass for gravity
        let centerX = 0, centerY = 0, count = 0;
        graph.forEachNode((node) => {
            const attrs = graph.getNodeAttributes(node);
            centerX += attrs.x || 0;
            centerY += attrs.y || 0;
            count++;
            // Reset velocities
            graph.setNodeAttribute(node, 'vx', 0);
            graph.setNodeAttribute(node, 'vy', 0);
        });
        centerX /= count || 1;
        centerY /= count || 1;

        let running = true;

        const simulate = () => {
            if (!running) return;

            const nodes = graph.nodes();
            const n = nodes.length;

            // Reset forces
            const forces = {};
            nodes.forEach(node => {
                forces[node] = { fx: 0, fy: 0 };
            });

            // 0. GRAVITY: Pull all nodes toward center
            if (GRAVITY_STRENGTH > 0) {
                nodes.forEach(node => {
                    const attrs = graph.getNodeAttributes(node);
                    const dx = centerX - attrs.x;
                    const dy = centerY - attrs.y;
                    forces[node].fx += dx * GRAVITY_STRENGTH * 0.0001;
                    forces[node].fy += dy * GRAVITY_STRENGTH * 0.0001;
                });
            }

            // 1. Repulsion: All nodes push each other away
            for (let i = 0; i < n; i++) {
                const nodeA = nodes[i];
                const attrsA = graph.getNodeAttributes(nodeA);

                for (let j = i + 1; j < n; j++) {
                    const nodeB = nodes[j];
                    const attrsB = graph.getNodeAttributes(nodeB);

                    let dx = attrsB.x - attrsA.x;
                    let dy = attrsB.y - attrsA.y;
                    let dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < MIN_DISTANCE) dist = MIN_DISTANCE;

                    // Repulsion force (inverse square)
                    const force = REPULSION_STRENGTH / (dist * dist);
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;

                    forces[nodeA].fx -= fx;
                    forces[nodeA].fy -= fy;
                    forces[nodeB].fx += fx;
                    forces[nodeB].fy += fy;
                }
            }

            // 2. Edge Attraction: Connected nodes pull toward each other
            graph.forEachEdge((edge, attrs, source, target) => {
                const attrsA = graph.getNodeAttributes(source);
                const attrsB = graph.getNodeAttributes(target);

                const dx = attrsB.x - attrsA.x;
                const dy = attrsB.y - attrsA.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist > 0) {
                    const force = dist * EDGE_ATTRACTION;
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;

                    forces[source].fx += fx;
                    forces[source].fy += fy;
                    forces[target].fx -= fx;
                    forces[target].fy -= fy;
                }
            });

            // 3. Apply forces to velocities and positions
            nodes.forEach(node => {
                const attrs = graph.getNodeAttributes(node);
                let vx = (attrs.vx || 0) + forces[node].fx;
                let vy = (attrs.vy || 0) + forces[node].fy;

                // Damping
                vx *= DAMPING;
                vy *= DAMPING;

                // Update position
                graph.setNodeAttribute(node, 'x', attrs.x + vx);
                graph.setNodeAttribute(node, 'y', attrs.y + vy);
                graph.setNodeAttribute(node, 'vx', vx);
                graph.setNodeAttribute(node, 'vy', vy);
            });

            renderer.refresh();
            layoutRef.current = requestAnimationFrame(simulate);
        };

        layoutRef.current = requestAnimationFrame(simulate);

        return () => {
            running = false;
            if (layoutRef.current) {
                cancelAnimationFrame(layoutRef.current);
                layoutRef.current = null;
            }
        };
    }, [isPhysicsEnabled, graphData, repulsion, edgeInfluence, gravity]); // React to ALL slider changes!

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

        renderer.refresh();

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
                        zIndex: 1000,
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
