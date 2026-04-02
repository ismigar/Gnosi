import React, { useEffect, useRef } from 'react';

export const Minimap = ({ graph, mainRenderer, isDarkMode, onPanTo, onPanToNode }) => {
    const canvasRef = useRef(null);
    const viewportRef = useRef(null);
    const isDragging = useRef(false);
    const containerRef = useRef(null);
    const debugInfo = useRef({ click: null, target: null });
    const dragOffset = useRef({ x: 0, y: 0 });
    const hasDragged = useRef(false);

    // Helper to calculate bounds
    const getGraphBounds = () => {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        graph.forEachNode((_, attr) => {
            if (attr.hidden) return; // Ignore hidden nodes
            if (typeof attr.x === 'number') {
                minX = Math.min(minX, attr.x);
                maxX = Math.max(maxX, attr.x);
            }
            if (typeof attr.y === 'number') {
                minY = Math.min(minY, attr.y);
                maxY = Math.max(maxY, attr.y);
            }
        });
        return { minX, maxX, minY, maxY };
    };

    // Helper to convert Graph Coords -> Camera Coords (Normalized 0-1)
    // MUST match GraphViewer.jsx logic:
    // normX = (x - minX) / width
    // normY = 1 - (y - minY) / height  (Y is inverted)
    const graphToCamera = (gx, gy) => {
        const { minX, maxX, minY, maxY } = getGraphBounds();
        if (minX === Infinity) return { x: 0.5, y: 0.5 }; // Fallback

        const width = maxX - minX;
        const height = maxY - minY;

        const nx = (gx - minX) / width;
        const ny = 1 - (gy - minY) / height; // Invert Y to match GraphViewer/Sigma camera
        return { x: nx, y: ny };
    };

    useEffect(() => {
        if (!graph || !mainRenderer || !canvasRef.current || !containerRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        // Store transform in ref to share between draw and click without closure staleness
        const transformRef = { current: { cx: 0, cy: 0, scale: 1, width: 0, height: 0 } };

        const updateTransform = () => {
            const { width, height } = containerRef.current.getBoundingClientRect();
            canvas.width = width;
            canvas.height = height;

            const { minX, maxX, minY, maxY } = getGraphBounds();
            if (minX === Infinity) return null;

            const graphWidth = maxX - minX;
            const graphHeight = maxY - minY;
            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;

            const padding = 1.1;
            const scaleX = width / (graphWidth * padding);
            const scaleY = height / (graphHeight * padding);
            const scale = Math.min(scaleX, scaleY);

            transformRef.current = { cx, cy, scale, width, height, bounds: { minX, maxX, minY, maxY } };
            return transformRef.current;
        };

        // Transform helpers using the ref
        const graphToMinimap = (gx, gy) => {
            const { cx, cy, scale, width, height } = transformRef.current;
            const dx = gx - cx;
            const dy = gy - cy;
            return {
                x: width / 2 + dx * scale,
                y: height / 2 + dy * scale
            };
        };

        const minimapToGraph = (mx, my) => {
            const { cx, cy, scale, width, height } = transformRef.current;
            const dx = (mx - width / 2) / scale;
            const dy = (my - height / 2) / scale;
            return {
                x: cx + dx,
                y: cy + dy
            };
        };

        // ... (inside draw function)
        const draw = () => {
            const t = updateTransform();
            if (!t) return;

            const { width, height } = t;
            ctx.clearRect(0, 0, width, height);

            // Draw nodes
            const nodeColor = isDarkMode ? '#888' : '#666';
            ctx.fillStyle = nodeColor;

            graph.forEachNode((_, attr) => {
                if (attr.hidden) return;
                const pos = graphToMinimap(attr.x, attr.y);
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, 1.5, 0, Math.PI * 2);
                ctx.fill();
            });




        };

        draw();

        // 3. Sync Viewport Rect
        const syncViewport = () => {
            if (!viewportRef.current) return;

            const mainCamera = mainRenderer.getCamera();
            const mainDims = mainRenderer.getDimensions();

            // Get camera center (Normalized 0-1)
            const { x, y, ratio } = mainRenderer.getCamera().getState();

            // Debug Sync
            // console.log("Minimap Sync:", { camX: x, camY: y, ratio });

            // Convert Camera (Normalized) -> Graph Coordinates
            // We need bounds. If transformRef is not ready, try to update it or get bounds directly.
            let bounds = transformRef.current?.bounds;
            if (!bounds) {
                // Fallback if transform not yet set
                bounds = getGraphBounds();
            }
            const { minX, maxX, minY, maxY } = bounds;

            if (minX === Infinity) return; // Empty graph

            const graphWidth = maxX - minX;
            const graphHeight = maxY - minY;

            // Camera X = (graphX - minX) / width  => graphX = minX + width * camX
            const graphX = minX + graphWidth * x;

            // Camera Y = 1 - (graphY - minY) / height => graphY = minY + height * (1 - camY)
            const graphY = minY + graphHeight * (1 - y);

            // Convert to minimap coordinates
            const centerMinimap = graphToMinimap(graphX, graphY);

            // Fixed size 10x10 px for the blue dot
            const FIXED_SIZE = 10;

            // Center the box
            const finalX = centerMinimap.x - FIXED_SIZE / 2;
            const finalY = centerMinimap.y - FIXED_SIZE / 2;

            const vp = viewportRef.current;
            vp.style.transform = `translate(${finalX}px, ${finalY}px)`;
            vp.style.width = `${FIXED_SIZE}px`;
            vp.style.height = `${FIXED_SIZE}px`;

            // Always show
            vp.style.display = 'block';

            // Update debug info
            const debugEl = document.getElementById('minimap-debug');
            if (debugEl) {
                const { x, y, ratio } = mainRenderer.getCamera().getState();
                debugEl.innerText = `Cam: ${Math.round(x)},${Math.round(y)} | R:${ratio.toFixed(2)}`;
            }
        };

        // Initial sync
        syncViewport();

        // Listeners
        mainRenderer.on('afterRender', syncViewport);

        const camera = mainRenderer.getCamera();
        if (camera) {
            camera.on('updated', syncViewport);
        }

        // Polling fallback to ensure smooth updates even if events are missed
        // Removed aggressive polling: const pollInterval = setInterval(syncViewport, 50);

        // Also listen for graph changes (like visibility updates)
        // Sigma/Graphology emits 'nodeAttributesUpdated' if we use setNodeAttribute
        // But we might need to bind to the graph instance
        const handleGraphUpdate = () => {
            requestAnimationFrame(draw);
        };

        // If the graph instance supports events (Graphology does)
        if (graph.on) {
            graph.on('nodeAttributesUpdated', handleGraphUpdate);
            graph.on('cleared', handleGraphUpdate);
            graph.on('nodeAdded', handleGraphUpdate);
            graph.on('nodeDropped', handleGraphUpdate);
        }

        // Interaction
        const handleMinimapClick = (e) => {
            if (isDragging.current || hasDragged.current) return;

            // Ensure transform is up to date
            const t = updateTransform();
            if (!t) {
                console.warn("Minimap: Transform update failed (empty graph?)");
                return;
            }

            const rect = containerRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const graphPos = minimapToGraph(x, y);

            // Get bounds again (or store them in ref)
            const { minX, maxX, minY, maxY } = getGraphBounds();

            // Clamp to bounds to prevent flying into empty space
            const clampedX = Math.max(minX, Math.min(maxX, graphPos.x));
            const clampedY = Math.max(minY, Math.min(maxY, graphPos.y));

            console.log("Minimap Click:", {
                mouse: { x, y },
                graphPos,
                bounds: { minX, maxX, minY, maxY },
                clamped: { x: clampedX, y: clampedY },
                transform: transformRef.current
            });

            // Use the live graph from renderer to ensure we have latest attributes (hidden, etc)
            const liveGraph = mainRenderer.getGraph();

            // Find closest node to click to ensure we look at data
            let closestNode = null;
            let minDist = Infinity;

            liveGraph.forEachNode((node, attr) => {
                if (attr.hidden) return;
                const dx = attr.x - clampedX;
                const dy = attr.y - clampedY;
                const dist = dx * dx + dy * dy;
                if (dist < minDist) {
                    minDist = dist;
                    closestNode = { ...attr, key: node }; // Store node key for attribute setting
                }
            });

            console.log("Minimap Closest Node:", closestNode ? { key: closestNode.key, x: closestNode.x, y: closestNode.y, dist: Math.sqrt(minDist) } : "None");

            // Re-enable Snap-to-Node
            const targetX = closestNode ? closestNode.x : clampedX;
            const targetY = closestNode ? closestNode.y : clampedY;

            const finalX = Number(targetX);
            const finalY = Number(targetY);

            // Update debug info for persistent drawing
            debugInfo.current.click = { x, y };
            debugInfo.current.target = closestNode ? { x: closestNode.x, y: closestNode.y } : { x: targetX, y: targetY };
            // Redraw immediately
            draw();

            // Minimap should zoom IN to the clicked area to see node details
            // ratio < 1 = zoomed in, ratio > 1 = zoomed out
            // Use 0.6 for closer view of node and its immediate neighbors
            const targetRatio = 0.6;

            console.log("Minimap: Panning to node", closestNode?.key, "with ratio", targetRatio);

            // Use the callback which will handle coordinate transformation
            if (closestNode && onPanToNode) {
                onPanToNode(closestNode.key, targetRatio);
            } else if (onPanTo) {
                // If no node found, pan to clicked coordinates
                // MUST normalize first because GraphViewer.panTo expects camera coords
                const camPos = graphToCamera(finalX, finalY);
                onPanTo(camPos.x, camPos.y, targetRatio);
            }

            // DEBUG: Check projection again (Simplified)
            setTimeout(() => {
                if (mainRenderer && !mainRenderer.killed) {
                    const camera = mainRenderer.getCamera();
                    console.log("Minimap: Post-Click Camera State:", camera.getState());
                }
            }, 500);

            // Force update of debug text
            syncViewport();
        };

        const handleMinimapDoubleClick = () => {
            const camera = mainRenderer.getCamera();
            camera.animate({ x: 0, y: 0, ratio: 1.0 }, { duration: 500 });
        };

        const handleMouseDown = (e) => {
            if (e.target === viewportRef.current) {
                isDragging.current = true;
                hasDragged.current = false;

                // Calculate offset: Camera Center - Mouse Graph Position (Normalized)
                const rect = containerRef.current.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;

                updateTransform();
                const mouseGraphPos = minimapToGraph(mx, my);
                const mouseCamPos = graphToCamera(mouseGraphPos.x, mouseGraphPos.y);

                const cameraState = mainRenderer.getCamera().getState();
                dragOffset.current = {
                    x: cameraState.x - mouseCamPos.x,
                    y: cameraState.y - mouseCamPos.y
                };

                e.stopPropagation();
            }
        };

        const handleMouseEnter = () => {
            if (mainRenderer && !mainRenderer.killed) {
                // console.log("Minimap: Mouse Enter - Current Camera State:", mainRenderer.getCamera().getState());
            }
        };

        const handleMouseMove = (e) => {
            if (!isDragging.current) return;
            hasDragged.current = true;
            updateTransform(); // Ensure transform is fresh
            const rect = containerRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const graphPos = minimapToGraph(x, y);
            const camPos = graphToCamera(graphPos.x, graphPos.y);

            // Move center to mouse with offset
            mainRenderer.getCamera().setState({
                x: camPos.x + dragOffset.current.x,
                y: camPos.y + dragOffset.current.y
            });
        };

        const handleMouseUp = () => {
            isDragging.current = false;
        };

        const container = containerRef.current;
        container.addEventListener('mouseenter', handleMouseEnter);
        container.addEventListener('click', handleMinimapClick);
        container.addEventListener('dblclick', handleMinimapDoubleClick);
        container.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            mainRenderer.off('afterRender', syncViewport);
            const camera = mainRenderer.getCamera();
            if (camera) {
                camera.off('updated', syncViewport);
            }
            if (graph.off) {
                graph.off('nodeAttributesUpdated', handleGraphUpdate);
                graph.off('cleared', handleGraphUpdate);
                graph.off('nodeAdded', handleGraphUpdate);
                graph.off('nodeDropped', handleGraphUpdate);
            }
            container.removeEventListener('mouseenter', handleMouseEnter);
            container.removeEventListener('click', handleMinimapClick);
            container.removeEventListener('dblclick', handleMinimapDoubleClick);
            container.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('mouseup', handleMouseUp);
            // clearInterval(pollInterval);
        };

    }, [graph, mainRenderer, isDarkMode]); // Re-run if graph changes

    return (
        <div
            ref={containerRef}
            style={{
                position: 'absolute',
                bottom: '20px',
                left: '20px',
                width: '200px',
                height: '150px',
                background: isDarkMode ? 'rgba(30, 30, 30, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                border: `1px solid ${isDarkMode ? '#444' : '#ddd'}`,
                borderRadius: '8px',
                overflow: 'hidden',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                zIndex: 100
            }}
        >
            <canvas
                ref={canvasRef}
                style={{ width: '100%', height: '100%', display: 'block' }}
            />
            <div
                ref={viewportRef}
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    border: '2px solid white',
                    backgroundColor: '#ff0000',
                    borderRadius: '50%',
                    boxShadow: '0 0 4px rgba(0,0,0,0.5)',
                    pointerEvents: 'auto',
                    cursor: 'move',
                    boxSizing: 'border-box',
                    display: 'none'
                }}
            />

        </div>
    );
};
