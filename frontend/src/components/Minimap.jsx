import React, { useEffect, useRef } from 'react';
import {
    createMinimapTransform,
    getCameraViewportRect,
    getVisibleCameraRatio,
    getVisibleGraphBounds,
} from '../utils/graphViewGeometry';

export const Minimap = ({ graph, mainRenderer, isDarkMode, onPanToGraph, onPanToNode, onCenter }) => {
    const canvasRef = useRef(null);
    const viewportRef = useRef(null);
    const isDragging = useRef(false);
    const containerRef = useRef(null);
    const dragOffset = useRef({ x: 0, y: 0 });
    const hasDragged = useRef(false);

    useEffect(() => {
        if (!graph || !mainRenderer || !canvasRef.current || !containerRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        // Store transform in ref to share between draw and click without closure staleness
        const transformRef = { current: null };

        const updateTransform = () => {
            if (!containerRef.current || !canvasRef.current) return null;

            const { width, height } = containerRef.current.getBoundingClientRect();
            canvas.width = width;
            canvas.height = height;

            const bounds = getVisibleGraphBounds(graph);
            if (!bounds) return null;

            transformRef.current = createMinimapTransform(bounds, width, height);
            return transformRef.current;
        };

        const graphToMinimap = (gx, gy) => {
            return transformRef.current.graphToMinimap(gx, gy);
        };

        const minimapToGraph = (mx, my) => {
            return transformRef.current.minimapToGraph(mx, my);
        };

        // ... (inside draw function)
        const draw = () => {
            if (!ctx || !containerRef.current || !canvasRef.current) return;
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
            if (!viewportRef.current || !containerRef.current || !canvasRef.current) return;
            if (!mainRenderer || mainRenderer.killed) return;

            const transform = transformRef.current || updateTransform();
            const rect = getCameraViewportRect(mainRenderer, transform);
            if (!rect) return;

            const vp = viewportRef.current;
            vp.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
            vp.style.width = `${rect.width}px`;
            vp.style.height = `${rect.height}px`;
            vp.style.display = 'block';
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
            graph.on('eachNodeAttributesUpdated', handleGraphUpdate);
            graph.on('cleared', handleGraphUpdate);
            graph.on('nodeAdded', handleGraphUpdate);
            graph.on('nodeDropped', handleGraphUpdate);
        }

        // Interaction
        const handleMinimapClick = (e) => {
            if (isDragging.current || hasDragged.current) return;
            if (!containerRef.current) return;

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

            // Use the live graph from renderer to ensure we have latest attributes (hidden, etc)
            const liveGraph = mainRenderer.getGraph();

            // Find closest node to click to ensure we look at data
            let closestNode = null;
            let minDist = Infinity;

            liveGraph.forEachNode((node, attr) => {
                if (attr.hidden) return;
                const dx = attr.x - graphPos.x;
                const dy = attr.y - graphPos.y;
                const dist = dx * dx + dy * dy;
                if (dist < minDist) {
                    minDist = dist;
                    closestNode = { ...attr, key: node }; // Store node key for attribute setting
                }
            });



            // Re-enable Snap-to-Node
            // Keep clicks relative to the filtered graph. An absolute Sigma
            // ratio refers to the full graph, including hidden distant nodes.
            const visibleBounds = getVisibleGraphBounds(liveGraph);
            const overviewRatio = getVisibleCameraRatio(mainRenderer, visibleBounds);
            const currentRatio = mainRenderer.getCamera().getState().ratio;
            const targetRatio = Math.max(0.02, Math.min(currentRatio, overviewRatio) * 0.8);

            

            // Use the callback which will handle coordinate transformation
            if (closestNode && onPanToNode) {
                onPanToNode(closestNode.key, targetRatio);
            } else if (onPanToGraph) {
                onPanToGraph(graphPos.x, graphPos.y, targetRatio);
            }

            // Force update of debug text
            syncViewport();
        };

        const handleMinimapDoubleClick = () => {
            if (onCenter) onCenter();
        };

        const handleMouseDown = (e) => {
            if (e.target === viewportRef.current) {
                if (!containerRef.current) return;
                isDragging.current = true;
                hasDragged.current = false;

                // Calculate offset in Sigma's normalized camera coordinates.
                const rect = containerRef.current.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;

                updateTransform();
                const mouseGraphPos = minimapToGraph(mx, my);
                const mouseCamPos = mainRenderer.normalizationFunction(mouseGraphPos);

                const cameraState = mainRenderer.getCamera().getState();
                dragOffset.current = {
                    x: cameraState.x - mouseCamPos.x,
                    y: cameraState.y - mouseCamPos.y
                };

                e.stopPropagation();
            }
        };

        const handleMouseMove = (e) => {
            if (!isDragging.current) return;
            if (!containerRef.current || !mainRenderer || mainRenderer.killed) return;
            hasDragged.current = true;
            updateTransform(); // Ensure transform is fresh
            const rect = containerRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const graphPos = minimapToGraph(x, y);
            const camPos = mainRenderer.normalizationFunction(graphPos);

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
        container.addEventListener('click', handleMinimapClick);
        container.addEventListener('dblclick', handleMinimapDoubleClick);
        container.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            if (mainRenderer && !mainRenderer.killed) {
                mainRenderer.off('afterRender', syncViewport);
            }
            const camera = mainRenderer && !mainRenderer.killed ? mainRenderer.getCamera() : null;
            if (camera) {
                camera.off('updated', syncViewport);
            }
            if (graph.off) {
                graph.off('nodeAttributesUpdated', handleGraphUpdate);
                graph.off('eachNodeAttributesUpdated', handleGraphUpdate);
                graph.off('cleared', handleGraphUpdate);
                graph.off('nodeAdded', handleGraphUpdate);
                graph.off('nodeDropped', handleGraphUpdate);
            }
            container.removeEventListener('click', handleMinimapClick);
            container.removeEventListener('dblclick', handleMinimapDoubleClick);
            container.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

    }, [graph, mainRenderer, isDarkMode, onCenter, onPanToGraph, onPanToNode]);

    return (
        <div
            ref={containerRef}
            data-testid="graph-minimap"
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
                data-testid="graph-minimap-viewport"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    border: '2px solid #ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    borderRadius: '3px',
                    boxShadow: '0 0 4px rgba(0,0,0,0.25)',
                    pointerEvents: 'auto',
                    cursor: 'move',
                    boxSizing: 'border-box',
                    display: 'none'
                }}
            />

        </div>
    );
};
