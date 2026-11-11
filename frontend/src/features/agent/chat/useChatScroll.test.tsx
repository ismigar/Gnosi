import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useChatScroll } from './useChatScroll';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let height: number;
function Panel({ session = 'one', revision = 0, visible = true }) {
    const { messagesContainerRef, handleMessagesScroll } = useChatScroll(session, revision, visible);
    return <div ref={element => {
        messagesContainerRef.current = element;
        if (element) {
            Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => height });
            Object.defineProperty(element, 'clientHeight', { configurable: true, value: 200 });
        }
    }} onScroll={handleMessagesScroll} />;
}
async function render(props: Parameters<typeof Panel>[0] = {}) {
    await act(async () => { root.render(<Panel {...props} />); await Promise.resolve(); });
    return host.firstElementChild as HTMLDivElement;
}
async function scroll(element: HTMLDivElement, top: number) {
    await act(async () => {
        element.scrollTop = top;
        element.dispatchEvent(new Event('scroll', { bubbles: true }));
        await Promise.resolve();
    });
}
beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    height = 1000;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); host.remove(); });

describe('chat scroll following', () => {
    it('preserves reading position across streamed and polled message updates and reopening', async () => {
        const panel = await render();
        expect(panel.scrollTop).toBe(1000);
        await scroll(panel, 200);
        height = 1200;
        await render({ revision: 1 });
        await render({ revision: 2 });
        expect(panel.scrollTop).toBe(200);
        await render({ revision: 2, visible: false });
        await render({ revision: 3 });
        expect(panel.scrollTop).toBe(200);
    });

    it('follows growth from the bottom and resumes when the reader scrolls back down', async () => {
        const panel = await render();
        await scroll(panel, 790);
        height = 1100;
        await render({ revision: 1 });
        expect(panel.scrollTop).toBe(1100);
        await scroll(panel, 100);
        height = 1200;
        await render({ revision: 2 });
        expect(panel.scrollTop).toBe(100);
        await scroll(panel, 1000);
        height = 1300;
        await render({ revision: 3 });
        expect(panel.scrollTop).toBe(1300);
    });

    it('opens another session at the end and defers updates while hidden', async () => {
        const panel = await render();
        await scroll(panel, 200);
        await render({ session: 'two', visible: false });
        expect(panel.scrollTop).toBe(200);
        height = 1500;
        await render({ session: 'two', revision: 1 });
        expect(panel.scrollTop).toBe(1500);
    });
});
