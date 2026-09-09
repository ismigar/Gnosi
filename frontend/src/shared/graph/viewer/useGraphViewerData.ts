import { useEffect, useRef } from 'react';
import { filterProjection } from './graphViewerProjection';
import { createPhysics } from './graphViewerPhysics';
import { fitGraph } from './graphViewerRuntime';
import { logError } from '../../notifications/notifyError';
import type { ContainerRef, OptionsRef, RuntimeRef, ViewerGraph, ViewerOptions } from './types';
export function useGraphViewerData(containerRef: ContainerRef, runtimeRef: RuntimeRef, latestRef: OptionsRef, options: ViewerOptions): void {
    const { graphData, filters, isPhysicsEnabled } = options;
    const filteredGraph = useRef<ViewerGraph | null>(null);
    useEffect(() => {
        const { graph, renderer, clearHover } = runtimeRef.current;
        if (!graph || !graphData)
            return;
        clearHover?.(false);
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (renderer && containerRef.current && containerRef.current.offsetWidth > 0) {
            // The renderer constructor already indexed the populated graph.
            if (!latestRef.current.isPhysicsEnabled)
                timer = setTimeout(() => { fitGraph(runtimeRef, 800); }, 100);
        }
        return () => { clearTimeout(timer); };
    }, [containerRef, runtimeRef, latestRef, graphData]);
    useEffect(() => {
        const { graph, renderer, clearHover } = runtimeRef.current;
        if (!graph || !renderer)
            return;
        clearHover?.(false);
        // Each replacement graph was filtered before its Sigma constructor.
        // Later filter changes still update the same live graph and its overlay.
        if (filteredGraph.current !== graph) filteredGraph.current = graph;
        else runtimeRef.current.semanticEdges = filterProjection(graph, filters, graphData);
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (containerRef.current && containerRef.current.offsetWidth > 0) {
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
        let fitTimer: ReturnType<typeof setTimeout> | undefined;
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
            runtimeRef.current.clearHover?.();
            // Sigma observes the batched coordinate change and schedules its
            // render. A full refresh here reindexes every node and edge again.
            copyPositions();
            totalTicks += 4;
            if (totalTicks >= 300 || simulation.alpha() <= simulation.alphaMin()) {
                running = false;
                simulation.stop();
                fitTimer = setTimeout(() => { fitGraph(runtimeRef, 900); }, 300);
                return;
            }
            frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => {
            running = false;
            simulation.stop();
            cancelAnimationFrame(frame);
            clearTimeout(fitTimer);
        };
    }, [containerRef, runtimeRef, latestRef, isPhysicsEnabled, graphData, filters, repulsion, edgeInfluence, gravity, friction, linLogMode, strongGravityMode, outboundAttractionDistribution]);
}
