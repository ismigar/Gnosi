import { useEffect } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { logError } from '../../notifications/notifyError';
import { openBrowserWindow } from '../../platform/browser-events';
import { getVisibleHoverNeighborhood } from '../filtering/graphFilters';
import { createSettings } from './graphViewerSettings';
import { attachSemanticOverlay } from './graphViewerOverlay';
import { publishRenderer } from './graphViewerRuntime';
import type { HoverState } from './graphViewerReducers';
import type { ContainerRef, OptionsRef, RuntimeRef, ViewerGraph, ViewerNode, ViewerEdge } from './types';
export function useGraphViewerRenderer(containerRef: ContainerRef, runtimeRef: RuntimeRef, options: OptionsRef, graphData: unknown): void {
    useEffect(() => {
        const element = containerRef.current;
        if (!element)
            return;
        if (element.offsetWidth === 0 || element.offsetHeight === 0) {
            logError('graph-container', 'Container has no dimensions, waiting for next opportunity');
            return;
        }
        const state = runtimeRef.current;
        const initial = options.current;
        const graph: ViewerGraph = new Graph<ViewerNode, ViewerEdge>();
        state.graph = graph;
        initial.setGraphInstance?.(graph);
        const hover: HoverState = { node: null, distances: {}, edges: new Set() };
        const clearHover = (refresh = true) => {
            const hadHover = hover.node !== null;
            hover.node = null;
            hover.distances = {};
            hover.edges = new Set();
            if (refresh && element.offsetWidth > 0)
                state.renderer?.refresh();
            if (hadHover)
                options.current.onNodeHover?.(null);
            element.style.cursor = 'default';
        };
        state.clearHover = clearHover;
        state.renderer?.kill();
        const renderer = new Sigma(graph, element, createSettings(options, hover, initial));
        publishRenderer(renderer);
        state.renderer = renderer;
        initial.setRendererInstance?.(renderer);
        const detachOverlay = attachSemanticOverlay(renderer, graph, runtimeRef, options);
        const camera = renderer.getCamera();
        camera.setState({ x: 0.5, y: 0.4, ratio: 1.4 });
        const handleCameraUpdate = () => { clearHover(false); };
        camera.on('updated', handleCameraUpdate);
        renderer.on('enterNode', ({ node }) => {
            hover.node = node;
            hover.distances = {};
            const neighborhood = getVisibleHoverNeighborhood(graph, node);
            neighborhood.nodes.forEach(id => { hover.distances[id] = id === node ? 0 : 1; });
            hover.edges = neighborhood.edges;
            if (element.offsetWidth > 0)
                renderer.refresh();
            options.current.onNodeHover?.(node);
            element.style.cursor = options.current.isPathfindingMode ? 'crosshair' : 'pointer';
        });
        renderer.on('leaveNode', () => { clearHover(); });
        renderer.on('clickNode', ({ node, event }) => {
            if (options.current.isPathfindingMode)
                options.current.onSelectPathNode?.(node);
            else if (event.original.metaKey || event.original.ctrlKey) {
                const attrs = graph.getNodeAttributes(node);
                if (attrs.url && attrs.kind !== 'tag')
                    openBrowserWindow(attrs.url, '_blank');
            }
            else
                options.current.onNodeClick?.(node);
        });
        // No rightClick interception: the native context menu remains available.
        return () => {
            camera.off('updated', handleCameraUpdate);
            detachOverlay();
            try {
                renderer.kill();
            }
            catch (error) {
                logError('graph-renderer-cleanup', error);
            }
            state.renderer = null;
            state.clearHover = null;
            initial.setRendererInstance?.(null);
        };
    }, [containerRef, runtimeRef, options, graphData]);
}
