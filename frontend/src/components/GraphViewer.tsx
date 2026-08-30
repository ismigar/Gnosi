import { useEffect, useImperativeHandle, useRef } from 'react';
import { subscribeWindowEvent } from '../shared/platform/browser-events';
import { GRAPH_KEYBOARD_ACTIONS, getGraphKeyboardAction, getPannedCameraState } from '../utils/graphKeyboardNavigation';
import { createViewerHandle, fitGraph } from './graph-viewer/graphViewerRuntime';
import { useGraphViewerRenderer } from './graph-viewer/useGraphViewerRenderer';
import { useGraphViewerData, useGraphViewerPhysics } from './graph-viewer/useGraphViewerData';
import type { GraphViewerHandle, GraphViewerProps, ViewerOptions, ViewerRuntime } from './graph-viewer/types';
export type { GraphViewerHandle, GraphViewerProps } from './graph-viewer/types';
export function GraphViewer({ ref, showArrows = true, labelThreshold = 14, nodeSize = 1, edgeThickness = 1, gravity = 1, repulsion = 1000, friction = 1, edgeInfluence = 1, linLogMode = true, strongGravityMode = false, outboundAttractionDistribution = false, ...props }: GraphViewerProps) {
    const options: ViewerOptions = { ...props, showArrows, labelThreshold, nodeSize, edgeThickness, gravity, repulsion, friction, edgeInfluence, linLogMode, strongGravityMode, outboundAttractionDistribution };
    const container = useRef<HTMLDivElement>(null);
    const runtime = useRef<ViewerRuntime>({ graph: null, renderer: null, clearHover: null, semanticEdges: [] });
    const latest = useRef(options);
    useEffect(() => { latest.current = options; });
    useEffect(() => {
        const renderer = runtime.current.renderer;
        if (!renderer)
            return;
        renderer.setSetting('renderEdgeLabels', false);
        renderer.setSetting('labelRenderedSizeThreshold', labelThreshold);
        if (container.current && container.current.offsetWidth > 0)
            renderer.refresh();
    }, [labelThreshold, showArrows, nodeSize, edgeThickness, props.pathSource, props.pathTarget, props.filters?.pathResult, props.filters?.onlyIsolated, props.filters?.selectedNode, props.isDarkMode, props.colorMode]);
    useImperativeHandle<Pick<GraphViewerHandle, 'center' | 'zoomIn' | 'zoomOut'>, GraphViewerHandle>(ref, () => createViewerHandle(runtime, container), []);
    useEffect(() => subscribeWindowEvent('keydown', event => {
        const action = getGraphKeyboardAction(event);
        const camera = runtime.current.renderer?.getCamera();
        if (!action || !camera)
            return;
        event.preventDefault();
        if (action === GRAPH_KEYBOARD_ACTIONS.ZOOM_IN) {
            void camera.animatedZoom({ duration: 300 });
            return;
        }
        if (action === GRAPH_KEYBOARD_ACTIONS.ZOOM_OUT) {
            void camera.animatedUnzoom({ duration: 300 });
            return;
        }
        if (action === GRAPH_KEYBOARD_ACTIONS.CENTER) {
            fitGraph(runtime, 400);
            return;
        }
        const next = getPannedCameraState(camera.getState(), action);
        if (next)
            void camera.animate(next, { duration: 160, easing: 'cubicInOut' });
    }), []);
    useGraphViewerRenderer(container, runtime, latest, props.graphData);
    useGraphViewerData(container, runtime, latest, options);
    useGraphViewerPhysics(container, runtime, latest, options);
    // The legacy tooltip state was permanently null; preserve the same DOM.
    return <div ref={container} style={{ width: '100%', height: '100%', position: 'relative' }}/>;
}
