import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Graph from 'graphology';

import { Minimap } from './Minimap';
import type { MinimapNodeAttributes, MinimapRenderer } from './minimapRuntime';

function activeFixture() {
    const graph = new Graph<MinimapNodeAttributes>();
    graph.addNode('one', { x: 0, y: 0 });
    graph.addNode('two', { x: 1, y: 1 });
    graph.addNode('hidden', { x: 1000, y: 1000, hidden: true });
    const renderListeners = new Set<() => void>();
    const cameraListeners = new Set<() => void>();
    const camera = {
        getState: () => ({ x: 0, y: 0, ratio: 1, angle: 0 }),
        setState: vi.fn(),
        on: vi.fn((_event: string, callback: () => void) => { cameraListeners.add(callback); }),
        off: vi.fn((_event: string, callback: () => void) => { cameraListeners.delete(callback); }),
    };
    const renderer = {
        getCamera: () => camera,
        getGraph: () => graph,
        getDimensions: () => ({ width: 200, height: 150 }),
        getGraphToViewportRatio: () => 1,
        viewportToGraph: ({ x, y }: { x: number; y: number }) => ({ x: x / 100, y: y / 100 }),
        on: vi.fn((_event: string, callback: () => void) => { renderListeners.add(callback); }),
        off: vi.fn((_event: string, callback: () => void) => { renderListeners.delete(callback); }),
    };
    const context = {
        clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillStyle: '',
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 150));
    return { graph, renderer, cameraListeners, renderListeners, context, mainRenderer: renderer as unknown as MinimapRenderer };
}

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;

describe('Minimap', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.useFakeTimers();
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('draws only once per frame after graph, camera and renderer updates', () => {
        const fixture = activeFixture();
        act(() => { root.render(<Minimap {...fixture} isDarkMode />); });
        expect(fixture.context.fill).toHaveBeenCalledTimes(1);
        expect(fixture.context.arc).toHaveBeenCalledTimes(2);
        const resize = vi.spyOn(HTMLCanvasElement.prototype, 'width', 'set');
        for (let index = 0; index < 50; index += 1) {
            fixture.graph.setNodeAttribute('one', 'x', index / 50);
            fixture.cameraListeners.forEach(callback => { callback(); });
            fixture.renderListeners.forEach(callback => { callback(); });
        }
        expect(fixture.context.fill).toHaveBeenCalledTimes(1);
        act(() => { vi.advanceTimersToNextFrame(); });
        expect(fixture.context.fill).toHaveBeenCalledTimes(2);
        expect(fixture.context.arc).toHaveBeenCalledTimes(4);
        expect(resize).not.toHaveBeenCalled();
    });

    it('uses current navigation callbacks without reinstalling graph listeners', () => {
        const fixture = activeFixture();
        const originalPan = vi.fn(), nextPan = vi.fn(), nextCenter = vi.fn();
        act(() => { root.render(<Minimap {...fixture} isDarkMode onPanToNode={originalPan} />); });
        const subscriptions = fixture.renderer.on.mock.calls.length;
        act(() => { root.render(<Minimap {...fixture} isDarkMode onPanToNode={nextPan} onCenter={nextCenter} />); });
        expect(fixture.renderer.on).toHaveBeenCalledTimes(subscriptions);
        expect(fixture.context.fill).toHaveBeenCalledTimes(1);
        const target = container.querySelector('[data-testid="graph-minimap"]');
        act(() => {
            target?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 100, clientY: 75 }));
            target?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        });
        expect(originalPan).not.toHaveBeenCalled();
        expect(nextPan).toHaveBeenCalledTimes(1);
        expect(nextCenter).toHaveBeenCalledTimes(1);
    });

    it('cancels pending paints when the graph changes or the minimap closes', () => {
        const fixture = activeFixture();
        act(() => { root.render(<Minimap {...fixture} isDarkMode />); });
        fixture.graph.setNodeAttribute('one', 'x', 2);
        const replacement = new Graph<MinimapNodeAttributes>();
        replacement.addNode('replacement', { x: 4, y: 4 });
        act(() => { root.render(<Minimap {...fixture} graph={replacement} isDarkMode />); });
        const draws = fixture.context.fill.mock.calls.length;
        act(() => { vi.advanceTimersToNextFrame(); });
        expect(fixture.context.fill).toHaveBeenCalledTimes(draws);
        replacement.setNodeAttribute('replacement', 'x', 5);
        act(() => { root.render(null); });
        act(() => { vi.advanceTimersToNextFrame(); });
        expect(fixture.renderListeners.size).toBe(0);
        expect(fixture.cameraListeners.size).toBe(0);
        expect(fixture.context.fill).toHaveBeenCalledTimes(draws);
    });

    it('preserves the minimap canvas and viewport shell without active graph data', () => {
        act(() => {
            root.render(
                <Minimap
                    graph={null}
                    isDarkMode
                    mainRenderer={null}
                />,
            );
        });

        const minimap = container.querySelector('[data-testid="graph-minimap"]');
        const viewport = container.querySelector(
            '[data-testid="graph-minimap-viewport"]',
        );
        expect(minimap).toBeInstanceOf(HTMLDivElement);
        expect(viewport).toBeInstanceOf(HTMLDivElement);
        if (!(minimap instanceof HTMLDivElement)) return;
        if (!(viewport instanceof HTMLDivElement)) return;
        expect(minimap.style.background).toBe('rgba(30, 30, 30, 0.95)');
        expect(minimap.querySelector('canvas')).toBeInstanceOf(HTMLCanvasElement);
        expect(viewport.style.display).toBe('none');
    });
});
