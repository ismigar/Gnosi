import Sigma from 'sigma';
import { normalizeGraphPoint, visibleCameraRatio } from '../minimapRuntime';
import { getVisibleGraphBounds } from '../../utils/graphViewGeometry';
import { logError } from '../../lib/notifyError';
import type { ContainerRef, GraphViewerHandle, RuntimeRef, ViewerRenderer } from './types';
/** Compatibility with existing integrations inspecting window.sigmaRenderer. */
export function publishRenderer(renderer: ViewerRenderer): void {
    Object.assign(renderer, { customId: Math.random().toString(36).slice(2, 11) });
    Reflect.set(window, 'sigmaRenderer', renderer);
}
function legacyRenderer(): ViewerRenderer | null {
    const candidate: unknown = Reflect.get(window, 'sigmaRenderer');
    // Sigma erases its attribute generics at runtime; this is the legacy viewer
    // slot, not a generic renderer registry. Preserve its historical fallback.
    return candidate instanceof Sigma ? candidate as ViewerRenderer : null;
}
export function fitGraph(runtime: RuntimeRef, durationMs = 800): void {
    const { graph, renderer } = runtime.current;
    if (!graph || !renderer)
        return;
    const bounds = getVisibleGraphBounds(graph);
    if (!bounds)
        return;
    const point = normalizeGraphPoint(renderer, { x: bounds.centerX, y: bounds.centerY });
    void renderer.getCamera().animate({ ...point, ratio: visibleCameraRatio(renderer, bounds) }, { duration: durationMs, easing: 'cubicInOut' });
}
export function createViewerHandle(runtime: RuntimeRef, container: ContainerRef): GraphViewerHandle {
    const getRenderer = () => runtime.current.renderer || legacyRenderer();
    return {
        zoomIn() { void runtime.current.renderer?.getCamera().animatedZoom({ duration: 500 }); },
        zoomOut() { void runtime.current.renderer?.getCamera().animatedUnzoom({ duration: 500 }); },
        center() { fitGraph(runtime, 700); },
        fullscreen() {
            if (!container.current)
                return;
            if (document.fullscreenElement !== container.current)
                void container.current.requestFullscreen();
            else
                void document.exitFullscreen();
        },
        panTo(x, y, ratio = 1) {
            const renderer = getRenderer();
            const safeX = Number(x), safeY = Number(y);
            if (renderer && !isNaN(safeX) && !isNaN(safeY)) {
                void renderer.getCamera().animate({ x: safeX, y: safeY, ratio }, { duration: 500 });
            }
        },
        panToGraphPoint(x, y, ratio = 1) {
            const renderer = getRenderer();
            const graphX = Number(x), graphY = Number(y);
            if (!renderer || !Number.isFinite(graphX) || !Number.isFinite(graphY))
                return;
            const point = normalizeGraphPoint(renderer, { x: graphX, y: graphY });
            void renderer.getCamera().animate({ ...point, ratio }, { duration: 500, easing: 'cubicInOut' });
        },
        panToNode(nodeId, ratio = null) {
            const renderer = getRenderer();
            const graph = renderer?.getGraph();
            if (renderer && graph?.hasNode(nodeId)) {
                const camera = renderer.getCamera();
                const point = normalizeGraphPoint(renderer, graph.getNodeAttributes(nodeId));
                void camera.animate({ ...point, ratio: ratio !== null ? ratio : camera.ratio }, { duration: 500, easing: 'cubicInOut' });
            }
            else
                logError('graph-pan', `Could not pan to node ${nodeId}`);
        },
    };
}
