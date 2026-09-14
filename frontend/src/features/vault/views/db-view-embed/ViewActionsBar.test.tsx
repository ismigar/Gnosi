import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ViewActionsBar } from './ViewActionsBar';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./ViewTools', () => ({ ViewTools: () => <button>Tools</button> }));
vi.mock('./NewRecordMenu', () => ({ NewRecordMenu: () => <button>Create</button> }));

it('adapts to its own column and keeps secondary callbacks reachable', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let resize: ResizeObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback: ResizeObserverCallback) { resize = callback; }
        observe = vi.fn();
        disconnect = disconnect;
    });
    const container = document.createElement('div');
    container.className = 'vault-view-toolbar';
    document.body.append(container);
    const root = createRoot(container);
    const add = vi.fn();
    try {
        await act(async () => { root.render(<ViewActionsBar searchTerm="" showSearch={false} density="compact" onAddView={add} />); await Promise.resolve(); });
        const notify = async (width: number) => {
            await act(async () => { resize?.([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver); await Promise.resolve(); });
        };
        await notify(420);
        const summary = container.querySelector('summary');
        expect(summary?.hidden).toBe(false);
        await act(async () => { summary?.click(); await Promise.resolve(); });
        await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="views_header.add_view"]')?.click(); await Promise.resolve(); });
        expect(add).toHaveBeenCalledOnce();
        await notify(1000);
        expect(summary?.hidden).toBe(true);
        expect(container.querySelector('details')?.open).toBe(true);
    } finally {
        await act(async () => { root.unmount(); await Promise.resolve(); });
        container.remove();
        vi.unstubAllGlobals();
    }
});
