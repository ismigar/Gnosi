import { act, createRef, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphViewer, type GraphViewerHandle } from './GraphViewer';
import { fixtureData, fixtureOptions } from './graphViewerFixtures';
import { latestRenderer, TestRenderer } from './graphViewerTestRenderer';
import { dispatchWindowEvent, openBrowserWindow } from '../../platform/browser-events';
vi.mock('sigma', async () => {
    const { TestRenderer: Renderer } = await import('./graphViewerTestRenderer');
    return { default: Renderer };
});
vi.mock('../../notifications/notifyError', () => ({ logError: vi.fn() }));
vi.mock('../../platform/browser-events', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../platform/browser-events')>(),
    openBrowserWindow: vi.fn(),
}));
const cleanups = new Set<() => void>();
function render(element: ReactNode) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const rerender = (content: ReactNode) => { act(() => { root.render(content); }); };
    const unmount = () => {
        act(() => { root.unmount(); });
        container.remove();
        cleanups.delete(unmount);
    };
    cleanups.add(unmount);
    rerender(element);
    return { rerender, unmount };
}
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    TestRenderer.instances = [];
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
    cleanups.forEach(unmount => { unmount(); });
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, 'sigmaRenderer');
});
describe('GraphViewer integration', () => {
    it('exposes all camera methods, rejects invalid points, normalizes graph coordinates and uses the live renderer graph', () => {
        const ref = createRef<GraphViewerHandle>();
        render(<GraphViewer {...fixtureOptions()} ref={ref}/>);
        const renderer = latestRenderer();
        act(() => {
            ref.current?.zoomIn();
            ref.current?.zoomOut();
            ref.current?.panTo('0.3', 0.4);
            ref.current?.panToGraphPoint(20, 30, 0.7);
        });
        expect(renderer.camera.animatedZoom).toHaveBeenCalledWith({ duration: 500 });
        expect(renderer.camera.animatedUnzoom).toHaveBeenCalledWith({ duration: 500 });
        expect(renderer.camera.animate).toHaveBeenCalledWith({ x: 0.3, y: 0.4, ratio: 1 }, { duration: 500 });
        expect(renderer.camera.animate).toHaveBeenLastCalledWith({ x: 0.2, y: 0.3, ratio: 0.7 }, { duration: 500, easing: 'cubicInOut' });
        renderer.camera.animate.mockClear();
        act(() => { ref.current?.panTo('invalid', 1); ref.current?.panToGraphPoint(Infinity, 2); });
        expect(renderer.camera.animate).not.toHaveBeenCalled();
        renderer.graph.setNodeAttribute('a', 'x', 50);
        renderer.graph.setNodeAttribute('a', 'y', 70);
        act(() => { ref.current?.panToNode('a'); });
        expect(renderer.camera.animate).toHaveBeenLastCalledWith({ x: 0.5, y: 0.7, ratio: 1.4 }, { duration: 500, easing: 'cubicInOut' });
        act(() => { ref.current?.center(); });
        expect(renderer.camera.animate.mock.lastCall?.[1]).toEqual({ duration: 700, easing: 'cubicInOut' });
        expect(typeof renderer.camera.animate.mock.lastCall?.[0].ratio).toBe('number');
    });
    it('keeps hover, modified navigation, path selection and callback updates without reinitializing Sigma', () => {
        const click = vi.fn(), hover = vi.fn(), path = vi.fn();
        const options = fixtureOptions({ onNodeClick: click, onNodeHover: hover, onSelectPathNode: path });
        const view = render(<GraphViewer {...options}/>);
        const renderer = latestRenderer();
        renderer.graph.setNodeAttribute('a', 'url', 'https://example.com/a');
        act(() => { renderer.emitNode('enterNode', 'a'); renderer.emitNode('clickNode', 'a'); });
        expect(hover).toHaveBeenCalledWith('a');
        expect(click).toHaveBeenCalledWith('a');
        expect(renderer.container.style.cursor).toBe('pointer');
        act(() => { renderer.emitNode('clickNode', 'a', true); });
        expect(openBrowserWindow).toHaveBeenCalledWith('https://example.com/a', '_blank');
        view.rerender(<GraphViewer {...options} isPathfindingMode/>);
        expect(TestRenderer.instances).toHaveLength(1);
        act(() => { renderer.emitNode('clickNode', 'b'); renderer.cameraListeners.forEach(listener => { listener(); }); });
        expect(path).toHaveBeenCalledWith('b');
        expect(hover).toHaveBeenLastCalledWith(null);
        expect(renderer.container.style.cursor).toBe('default');
        expect(renderer.listeners.has('rightClickNode')).toBe(false);
        expect(renderer.listeners.has('rightClickStage')).toBe(false);
    });
    it('filters before physics, updates settings, rebuilds on data changes and releases listeners', () => {
        const ref = createRef<GraphViewerHandle>();
        const setRenderer = vi.fn();
        const options = fixtureOptions({ setRendererInstance: setRenderer });
        const view = render(<GraphViewer {...options} ref={ref} isPhysicsEnabled/>);
        const first = latestRenderer();
        view.rerender(<GraphViewer {...options} ref={ref} isPhysicsEnabled filters={{ searchTerm: 'isolated' }} labelThreshold={22}/>);
        expect(first.graph.getNodeAttribute('a', 'hidden')).toBe(true);
        expect(first.setSetting).toHaveBeenCalledWith('labelRenderedSizeThreshold', 22);
        act(() => { vi.advanceTimersByTime(100); });
        expect(first.graph.getNodeAttribute('isolated', 'x')).toEqual(expect.any(Number));
        view.rerender(<GraphViewer {...options} ref={ref} graphData={fixtureData()}/>);
        expect(first.kill).toHaveBeenCalledTimes(1);
        expect(TestRenderer.instances).toHaveLength(2);
        const second = latestRenderer();
        act(() => { dispatchWindowEvent(new KeyboardEvent('keydown', { key: '+', cancelable: true })); });
        expect(second.camera.animatedZoom).toHaveBeenCalledWith({ duration: 300 });
        view.unmount();
        expect(second.kill).toHaveBeenCalledTimes(1);
        expect(second.cameraListeners.size).toBe(0);
        expect(second.listeners.size).toBe(0);
        expect(setRenderer).toHaveBeenLastCalledWith(null);
        second.camera.animatedZoom.mockClear();
        dispatchWindowEvent(new KeyboardEvent('keydown', { key: '+' }));
        expect(second.camera.animatedZoom).not.toHaveBeenCalled();
        expect(ref.current).toBeNull();
    });
    it('toggles fullscreen for its own container', () => {
        const request = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
        const exit = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
        Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request });
        Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
        const ref = createRef<GraphViewerHandle>();
        render(<GraphViewer {...fixtureOptions()} ref={ref}/>);
        act(() => { ref.current?.fullscreen(); });
        expect(request).toHaveBeenCalledTimes(1);
        Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: latestRenderer().container });
        act(() => { ref.current?.fullscreen(); });
        expect(exit).toHaveBeenCalledTimes(1);
        Reflect.deleteProperty(document, 'fullscreenElement');
        Reflect.deleteProperty(document, 'exitFullscreen');
        Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
    });
});
