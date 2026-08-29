import { useEffect, useRef } from 'react';

import { subscribeWindowEvent } from '../shared/platform/browser-events';
import {
    createMinimapTransform,
    getCameraGraphBounds,
    getCameraViewportRect,
    getVisibleGraphBounds,
    mergeGraphBounds,
} from '../utils/graphViewGeometry';
import {
    findClosestVisibleNode,
    isRendererKilled,
    normalizeGraphPoint,
    visibleCameraRatio,
    type GraphPoint,
    type MinimapGraph,
    type MinimapRenderer,
    type MinimapTransform,
} from './minimapRuntime';

interface MinimapProps {
    graph: MinimapGraph | null;
    isDarkMode: boolean;
    mainRenderer: MinimapRenderer | null;
    onCenter?: () => void;
    onPanToGraph?: (x: number, y: number, ratio: number) => void;
    onPanToNode?: (nodeId: string, ratio: number) => void;
}

export const Minimap = ({
    graph,
    mainRenderer,
    isDarkMode,
    onPanToGraph,
    onPanToNode,
    onCenter,
}: MinimapProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const dragOffset = useRef<GraphPoint>({ x: 0, y: 0 });
    const hasDragged = useRef(false);

    useEffect(() => {
        if (!graph || !mainRenderer || !canvasRef.current || !containerRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        // Store transform in ref to share between draw and click without closure staleness
        const transformRef: { current: MinimapTransform | null } = { current: null };

        const updateTransform = (): MinimapTransform | null => {
            if (!containerRef.current || !canvasRef.current) return null;

            const { width, height } = containerRef.current.getBoundingClientRect();
            canvas.width = width;
            canvas.height = height;

            const bounds = mergeGraphBounds(
                getVisibleGraphBounds(graph),
                getCameraGraphBounds(mainRenderer),
            );
            if (!bounds) return null;

            transformRef.current = createMinimapTransform(bounds, width, height);
            return transformRef.current;
        };

        const draw = (): MinimapTransform | undefined => {
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
                const pos = t.graphToMinimap(attr.x, attr.y);
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, 1.5, 0, Math.PI * 2);
                ctx.fill();
            });

            return t;
        };

        const syncViewport = (currentTransform?: MinimapTransform): void => {
            if (!viewportRef.current || !containerRef.current || !canvasRef.current) return;
            if (isRendererKilled(mainRenderer)) return;

            const transform = currentTransform || transformRef.current || updateTransform();
            const rect = getCameraViewportRect(mainRenderer, transform);
            if (!rect) return;

            const vp = viewportRef.current;
            vp.style.transform = `translate(${String(rect.x)}px, ${String(rect.y)}px)`;
            vp.style.width = `${String(rect.width)}px`;
            vp.style.height = `${String(rect.height)}px`;
            vp.style.display = 'block';
        };

        const renderMinimap = (): void => {
            const transform = draw();
            if (transform) syncViewport(transform);
        };

        // Initial sync
        renderMinimap();

        // Listeners
        mainRenderer.on('afterRender', renderMinimap);

        const camera = mainRenderer.getCamera();
        camera.on('updated', renderMinimap);

        // Also listen for graph changes (like visibility updates)
        // Sigma/Graphology emits 'nodeAttributesUpdated' if we use setNodeAttribute
        // But we might need to bind to the graph instance
        const handleGraphUpdate = () => {
            requestAnimationFrame(renderMinimap);
        };

        graph.on('nodeAttributesUpdated', handleGraphUpdate);
        graph.on('eachNodeAttributesUpdated', handleGraphUpdate);
        graph.on('cleared', handleGraphUpdate);
        graph.on('nodeAdded', handleGraphUpdate);
        graph.on('nodeDropped', handleGraphUpdate);

        // Interaction
        const handleMinimapClick = (event: MouseEvent): void => {
            if (isDragging.current || hasDragged.current) return;
            if (!containerRef.current) return;

            // Ensure transform is up to date
            const t = updateTransform();
            if (!t) return;

            const rect = containerRef.current.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            const graphPos = t.minimapToGraph(x, y);

            // Use the live graph from renderer to ensure we have latest attributes (hidden, etc)
            const liveGraph = mainRenderer.getGraph();

            const closestNode = findClosestVisibleNode(liveGraph, graphPos);

            // Keep clicks relative to the filtered graph. An absolute Sigma
            // ratio refers to the full graph, including hidden distant nodes.
            const visibleBounds = getVisibleGraphBounds(liveGraph);
            const overviewRatio = visibleCameraRatio(mainRenderer, visibleBounds);
            const currentRatio = mainRenderer.getCamera().getState().ratio;
            const targetRatio = Math.max(0.02, Math.min(currentRatio, overviewRatio) * 0.8);

            if (closestNode && onPanToNode) {
                onPanToNode(closestNode, targetRatio);
            } else if (onPanToGraph) {
                onPanToGraph(graphPos.x, graphPos.y, targetRatio);
            }

            // Force update of debug text
            renderMinimap();
        };

        const handleMinimapDoubleClick = (): void => {
            if (onCenter) onCenter();
        };

        const handleMouseDown = (event: MouseEvent): void => {
            if (event.target === viewportRef.current) {
                if (!containerRef.current) return;
                isDragging.current = true;
                hasDragged.current = false;

                // Calculate offset in Sigma's normalized camera coordinates.
                const rect = containerRef.current.getBoundingClientRect();
                const mx = event.clientX - rect.left;
                const my = event.clientY - rect.top;

                const transform = updateTransform();
                if (!transform) return;
                const mouseGraphPos = transform.minimapToGraph(mx, my);
                const mouseCamPos = normalizeGraphPoint(mainRenderer, mouseGraphPos);

                const cameraState = mainRenderer.getCamera().getState();
                dragOffset.current = {
                    x: cameraState.x - mouseCamPos.x,
                    y: cameraState.y - mouseCamPos.y,
                };

                event.stopPropagation();
            }
        };

        const handleMouseMove = (event: MouseEvent): void => {
            if (!isDragging.current) return;
            if (!containerRef.current || isRendererKilled(mainRenderer)) return;
            hasDragged.current = true;
            const transform = updateTransform();
            if (!transform) return;
            const rect = containerRef.current.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            const graphPos = transform.minimapToGraph(x, y);
            const camPos = normalizeGraphPoint(mainRenderer, graphPos);

            // Move center to mouse with offset
            mainRenderer.getCamera().setState({
                x: camPos.x + dragOffset.current.x,
                y: camPos.y + dragOffset.current.y,
            });
        };

        const handleMouseUp = (): void => {
            isDragging.current = false;
        };

        const container = containerRef.current;
        container.addEventListener('click', handleMinimapClick);
        container.addEventListener('dblclick', handleMinimapDoubleClick);
        container.addEventListener('mousedown', handleMouseDown);
        const unsubscribeMouseMove = subscribeWindowEvent('mousemove', handleMouseMove);
        const unsubscribeMouseUp = subscribeWindowEvent('mouseup', handleMouseUp);

        return () => {
            if (!isRendererKilled(mainRenderer)) {
                mainRenderer.off('afterRender', renderMinimap);
                camera.off('updated', renderMinimap);
            }
            graph.off('nodeAttributesUpdated', handleGraphUpdate);
            graph.off('eachNodeAttributesUpdated', handleGraphUpdate);
            graph.off('cleared', handleGraphUpdate);
            graph.off('nodeAdded', handleGraphUpdate);
            graph.off('nodeDropped', handleGraphUpdate);
            container.removeEventListener('click', handleMinimapClick);
            container.removeEventListener('dblclick', handleMinimapDoubleClick);
            container.removeEventListener('mousedown', handleMouseDown);
            unsubscribeMouseMove();
            unsubscribeMouseUp();
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
