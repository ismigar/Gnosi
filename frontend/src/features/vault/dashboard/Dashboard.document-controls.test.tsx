import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';

const state = vi.hoisted(() => ({
    tabs: [] as { id: string; title: string }[],
    activeTabId: null as string | null,
    viewMode: 'editor',
    handleTabClose: vi.fn<(id: string) => void>(),
    setIsGlobalSearchOpen: vi.fn(),
}));
vi.mock('./useDashboardController', () => ({ useDashboardController: () => ({
    ...state, breadcrumbs: [], promptModal: { isOpen: false },
}) }));
vi.mock('./DashboardSidebar', () => ({ DashboardSidebar: () => <nav>Navigation</nav> }));
vi.mock('./DashboardContent', () => ({ DashboardContent: () => <main>{state.activeTabId ? 'Document' : 'Choose a page'}</main> }));
vi.mock('./CreationRecoveryPanel', () => ({ CreationRecoveryPanel: () => null }));
vi.mock('../../../shared/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string | { defaultValue?: string }) => typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key }) }));

describe('dashboard document controls', () => {
    let container: HTMLDivElement;
    let root: Root;
    const render = () => { act(() => { root.render(<Dashboard />); }); };
    const closeButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="Close tab"]');
    beforeEach(() => {
        Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
        state.tabs = []; state.activeTabId = null; state.viewMode = 'editor';
        vi.clearAllMocks();
        state.handleTabClose.mockImplementation(id => { state.tabs = state.tabs.filter(tab => tab.id !== id); state.activeTabId = null; });
        container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    });
    afterEach(() => { act(() => { root.unmount(); }); container.remove(); Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT'); });
    it('does not show Close tab on an empty welcome screen', () => {
        render(); expect(closeButton()).toBeNull(); expect(container.textContent).toContain('Choose a page');
    });
    it('hides Close tab when one tab is remembered but no document is active', () => {
        state.tabs = [{ id: 'remembered', title: 'Remembered' }];
        render(); expect(closeButton()).toBeNull();
        expect(container.querySelector('svg.lucide-plus')).not.toBeNull();
        expect(container.querySelector('button[aria-label="Quick search"]')).not.toBeNull();
    });
    it('closes the active document and removes Close tab after the final tab closes', () => {
        state.tabs = [{ id: 'page', title: 'Page' }]; state.activeTabId = 'page'; render();
        const close = closeButton(); if (!close) throw new Error('Active tab close action missing');
        act(() => { close.click(); }); render();
        expect(state.handleTabClose).toHaveBeenCalledWith('page'); expect(closeButton()).toBeNull();
        expect(container.textContent).toContain('Choose a page');
    });
    it('does not offer Close tab for a stale active ID that has no matching tab', () => {
        state.tabs = [{ id: 'remembered', title: 'Remembered' }]; state.activeTabId = 'missing';
        render(); expect(closeButton()).toBeNull();
    });
});
