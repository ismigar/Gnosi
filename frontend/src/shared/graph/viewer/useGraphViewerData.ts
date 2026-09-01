import { useEffect } from 'react';
import { rebuildProjection, filterProjection } from './graphViewerProjection';
import { createPhysics } from './graphViewerPhysics';
import { fitGraph } from './graphViewerRuntime';
import { logError } from '../../notifications/notifyError';
import type { ContainerRef, OptionsRef, RuntimeRef, ViewerOptions } from './types';
export function useGraphViewerData(containerRef: ContainerRef, runtimeRef: RuntimeRef, latestRef: OptionsRef, options: ViewerOptions): void {
    const { graphData, filters, isPhysicsEnabled } = options;
    useEffect(() => {
        const { graph, renderer, clearHover } = runtimeRef.current;
        if (!graph || !graphData)
            return;
        clearHover?.(false);
        rebuildProjection(graph, graphData);
        if (renderer && containerRef.current && containerRef.current.offsetWidth > 0) {
            renderer.refresh();
            if (!latestRef.current.isPhysicsEnabled)
                setTimeout(() => { fitGraph(runtimeRef, 800); }, 100);
        }
    }, [containerRef, runtimeRef, latestRef, graphData]);
    useEffect(() => {
        const { graph, renderer, clearHover } = runtimeRef.current;
        if (!graph || !renderer)
            return;
        clearHover?.(false);
        runtimeRef.current.semanticEdges = filterProjection(graph, filters, graphData);
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (containerRef.current && containerRef.current.offsetWidth > 0) {
            renderer.refresh();
            if (!isPhysicsEnabled)
                timer = setTimeout(() => { fitGraph(runtimeRef, 500); }, 120);
        }
        return () => { clearTimeout(timer); };
    }, [containerRef, runtimeRef, filters, graphData, isPhysicsEnabled]);
}
export function useGraphViewerPhysics(containerRef: ContainerRef, runtimeRef: RuntimeRef, latestRef: OptionsRef, options: ViewerOptions): void {
    const { isPhysicsEnabled, graphData, filters, repulsion, edgeInfluence, gravity, friction, linLogMode, strongGravityMode, outboundAttractionDistribution } = options;
    useEffect(() => {
        const { graph, renderer } = runtimeRef.current;
        if (!graph || !renderer || !isPhysicsEnabled || graph.order === 0)
            return;
        const physics = createPhysics(graph, latestRef.current);
        if (!physics)
            return;
        const { simulation, simulationNodeById } = physics;
        let totalTicks = 0;
        let running = true;
        let frame: number;
        const copyPositions = () => {
            graph.updateEachNodeAttributes((node, attrs) => {
                const position = simulationNodeById.get(node);
                return position ? { ...attrs, x: position.x, y: position.y } : attrs;
            }, { attributes: ['x', 'y'] });
        };
        const step = () => {
            if (!running)
                return;
            try {
                simulation.tick(4);
            }
            catch (error) {
                logError('graph-layout', error);
                running = false;
                return;
            }
            runtimeRef.current.clearHover?.(false);
            copyPositions();
            totalTicks += 4;
            if (containerRef.current && containerRef.current.offsetWidth > 0)
                renderer.refresh();
            if (totalTicks >= 300 || simulation.alpha() <= simulation.alphaMin()) {
                running = false;
                simulation.stop();
                copyPositions();
                renderer.refresh();
                setTimeout(() => { fitGraph(runtimeRef, 900); }, 300);
                return;
            }
            frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => {
            running = false;
            simulation.stop();
            cancelAnimationFrame(frame);
        };
    }, [containerRef, runtimeRef, latestRef, isPhysicsEnabled, graphData, filters, repulsion, edgeInfluence, gravity, friction, linLogMode, strongGravityMode, outboundAttractionDistribution]);
}
