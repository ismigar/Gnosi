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
    readonly refresh = vi.fn();
    readonly kill = vi.fn(() => { this.listeners.clear(); });
    readonly setSetting = vi.fn();
    constructor(readonly graph: ViewerGraph, readonly container: HTMLElement, readonly settings: ReturnType<typeof createSettings>) {
        TestRenderer.instances.push(this);
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
