import { vi } from 'vitest';
import type { MouseCoords } from 'sigma/types';
import type { createSettings } from './graphViewerSettings';
import type { ViewerGraph } from './types';
interface Point {
    x: number;
    y: number;
}
interface NodeEvent {
    node: string;
    event: MouseCoords;
}
type Listener = ((event: NodeEvent) => void) | (() => void);
export class TestRenderer {
    static instances: TestRenderer[] = [];
    readonly listeners = new Map<string, Set<Listener>>();
    readonly cameraListeners = new Set<() => void>();
    readonly normalizationFunction = Object.assign((point: Point) => ({ x: point.x / 100, y: point.y / 100 }), { ratio: 100 });
    readonly camera = {
        ratio: 1.4,
        getState: () => ({ x: 0.5, y: 0.4, ratio: this.camera.ratio, angle: 0 }),
        animate: vi.fn<(state: Partial<{
            x: number;
            y: number;
            ratio: number;
            angle: number;
        }>, options: {
            duration: number;
            easing?: string;
        }) => void>(),
        animatedZoom: vi.fn<(options: {
            duration: number;
        }) => void>(),
        animatedUnzoom: vi.fn<(options: {
            duration: number;
        }) => void>(),
        setState: vi.fn<(state: {
            x: number;
            y: number;
            ratio: number;
        }) => void>(),
        on: (_event: string, listener: () => void) => { this.cameraListeners.add(listener); },
        off: (_event: string, listener: () => void) => { this.cameraListeners.delete(listener); },
    };
    private indexedNodes = new Set<string>();
    private indexedEdges = new Set<string>();
    private clearIndices = () => {
        this.indexedNodes.clear();
        this.indexedEdges.clear();
    };
    // Sigma's batched non-layout updates repaint existing program slots. They
    // fail if new topology has not had its initial synchronous refresh yet.
    private repaintNodes = ({ hints }: { hints?: { attributes?: (string | number)[] } }) => {
        if (!hints?.attributes || hints.attributes.some(attribute => attribute === 'x' || attribute === 'y' || attribute === 'zIndex' || attribute === 'type')) return;
        if (this.graph.nodes().some(node => !this.indexedNodes.has(node)))
            throw new Error('Cannot repaint a node before its first indexed render');
    };
    private repaintEdges = ({ hints }: { hints?: { attributes?: (string | number)[] } }) => {
        if (!hints?.attributes || hints.attributes.some(attribute => attribute === 'zIndex' || attribute === 'type')) return;
        if (this.graph.edges().some(edge => !this.indexedEdges.has(edge)))
            throw new Error('Cannot repaint an edge before its first indexed render');
    };
    readonly refresh = vi.fn(() => {
        this.indexedNodes = new Set(this.graph.nodes());
        this.indexedEdges = new Set(this.graph.edges());
    });
    readonly kill = vi.fn(() => {
        this.listeners.clear();
        this.graph.off('cleared', this.clearIndices);
        this.graph.off('eachNodeAttributesUpdated', this.repaintNodes);
        this.graph.off('eachEdgeAttributesUpdated', this.repaintEdges);
        this.graph.off('nodeAdded', this.nodeAdded);
        this.graph.off('edgeAdded', this.edgeAdded);
    });
    readonly setSetting = vi.fn();
    readonly initialNodes: ReadonlyArray<{ key: string; hidden: boolean; isolated: boolean; size?: number }>;
    readonly initialEdges: ReadonlyArray<{ key: string; hidden: boolean }>;
    readonly nodeAdded = vi.fn();
    readonly edgeAdded = vi.fn();
    constructor(readonly graph: ViewerGraph, readonly container: HTMLElement, readonly settings: ReturnType<typeof createSettings>) {
        this.initialNodes = graph.mapNodes((key, attrs) => ({
            key, hidden: Boolean(attrs.hidden), isolated: Boolean(attrs.isolated), size: attrs.size,
        }));
        this.initialEdges = graph.mapEdges((key, attrs) => ({ key, hidden: Boolean(attrs.hidden) }));
        TestRenderer.instances.push(this);
        graph.on('cleared', this.clearIndices);
        graph.on('eachNodeAttributesUpdated', this.repaintNodes);
        graph.on('eachEdgeAttributesUpdated', this.repaintEdges);
        graph.on('nodeAdded', this.nodeAdded);
        graph.on('edgeAdded', this.edgeAdded);
        // The real Sigma constructor synchronously refreshes its initial graph.
        this.refresh();
    }
    getCamera() { return this.camera; }
    getGraph() { return this.graph; }
    getDimensions() { return { width: 800, height: 600 }; }
    getGraphToViewportRatio() { return 1; }
    graphToViewport(point: Point) { return point; }
    createCanvas() { return document.createElement('canvas'); }
    on(event: string, listener: Listener): void {
        let listeners = this.listeners.get(event);
        if (!listeners) {
            listeners = new Set();
            this.listeners.set(event, listeners);
        }
        listeners.add(listener);
    }
    off(event: string, listener: Listener): void { this.listeners.get(event)?.delete(listener); }
    emitNode(event: string, node: string, modifier = false): void {
        const payload: NodeEvent = { node, event: { x: 0, y: 0, sigmaDefaultPrevented: false, preventSigmaDefault() { this.sigmaDefaultPrevented = true; }, original: new MouseEvent('click', { metaKey: modifier }) } };
        this.listeners.get(event)?.forEach(listener => { listener(payload); });
    }
}
export function latestRenderer(): TestRenderer {
    const renderer = TestRenderer.instances.at(-1);
    if (!renderer)
        throw new Error('Expected mounted renderer');
    return renderer;
}
