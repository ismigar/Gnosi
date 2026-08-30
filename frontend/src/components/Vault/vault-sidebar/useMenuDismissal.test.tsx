import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMenuDismissal } from './useMenuDismissal';

const handlers = vi.hoisted(() => ({ subscribe: vi.fn<(name: string, handler: unknown) => void>(), cleanup: vi.fn<() => void>() }));
vi.mock('../../../shared/platform/browser-events', () => ({
    eventTargetIsWithin: () => false,
    subscribeDocumentEvent: (name: string, handler: unknown) => { handlers.subscribe(name, handler); return handlers.cleanup; },
}));
let root: Root | undefined;
const close = () => {};
function Menu() {
    const ref = useRef<HTMLDivElement>(null);
    useMenuDismissal(true, ref, close);
    return <div ref={ref}>Menu</div>;
}
async function mount() {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers();
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => { root?.render(<Menu />); await Promise.resolve(); });
}
afterEach(async () => {
    await act(async () => { root?.unmount(); await Promise.resolve(); });
    root = undefined;
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.clearAllMocks();
});
describe('delayed menu subscriptions', () => {
    it('cancels delayed attachment when the menu unmounts before ten milliseconds', async () => {
        await mount();
        await act(async () => { root?.unmount(); root = undefined; await vi.advanceTimersByTimeAsync(20); });
        expect(handlers.subscribe).not.toHaveBeenCalled();
        expect(handlers.cleanup).not.toHaveBeenCalled();
    });
    it('cleans both click and keyboard subscriptions after attachment', async () => {
        await mount();
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });
        expect(handlers.subscribe.mock.calls.map(call => call[0])).toEqual(['click', 'keydown']);
        await act(async () => { root?.unmount(); root = undefined; await Promise.resolve(); });
        expect(handlers.cleanup).toHaveBeenCalledTimes(2);
    });
});
