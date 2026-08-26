import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppSidebar, ENGINEERING_DOCUMENTATION_URL } from './AppSidebar';
import { normalizeSidebarPreferences, orderSidebarItems } from '../lib/appSidebarNavigation';

const pluginState = vi.hoisted(() => ({ enabled: new Set(), settings: {} }));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, fallback) => fallback || key,
    }),
}));

vi.mock('../context/AuthContext', () => ({
    useAuth: () => ({ user: null, logout: vi.fn() }),
}));

vi.mock('../lib/toast', () => ({
    toast: { success: vi.fn() },
}));

vi.mock('../plugins/usePlugins', () => ({
    usePlugins: () => ({
        isEnabled: (pluginId) => pluginState.enabled.has(pluginId),
        getPluginSettings: () => pluginState.settings,
        setPluginSettings: vi.fn(),
    }),
}));

vi.mock('./Navigation/WorkspaceSwitcher', () => ({
    WorkspaceSwitcher: () => null,
}));

vi.mock('./VaultMenu', () => ({
    default: () => null,
}));

const mountedRoots = [];

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    pluginState.enabled.clear();
    pluginState.settings = {};
    localStorage.setItem('gnosi_active_vault_slug', 'principal');
    globalThis.fetch = vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ gnosi_mode: 'personal' }),
    });
});

afterEach(async () => {
    vi.restoreAllMocks();
    while (mountedRoots.length > 0) {
        const { root, container } = mountedRoots.pop();
        await act(async () => root.unmount());
        container.remove();
    }
});

describe('AppSidebar documentation access', () => {
    it('opens the canonical engineering portal in a separate browser context', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });

        await act(async () => {
            root.render(
                <MemoryRouter>
                    <AppSidebar />
                </MemoryRouter>,
            );
        });

        const link = container.querySelector(`a[href="${ENGINEERING_DOCUMENTATION_URL}"]`);
        expect(link).not.toBeNull();
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toContain('noopener');
        expect(link.getAttribute('aria-label')).toBe('Engineering documentation');
    });

    it('keeps optional navigation hidden until its plugin is enabled', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });

        await act(async () => {
            root.render(<MemoryRouter><AppSidebar /></MemoryRouter>);
        });
        expect(container.querySelector('a[href="/@principal/knowledge"]')).not.toBeNull();
        expect(container.querySelector('a[href="/@principal/graph"]')).not.toBeNull();
        expect(container.querySelector('a[href="/@principal/contacts"]')).toBeNull();

        pluginState.enabled.add('contacts');
        await act(async () => {
            root.render(<MemoryRouter><AppSidebar /></MemoryRouter>);
        });
        expect(container.querySelector('a[href="/@principal/contacts"]')).not.toBeNull();
    });
});

describe('AppSidebar adaptive navigation', () => {
    const items = [{ to: '/one' }, { to: '/two' }, { to: '/three' }];

    it('uses the current destination order when no preference exists', () => {
        expect(normalizeSidebarPreferences(items, {})).toEqual({
            pinnedRoutes: ['/one', '/two', '/three'],
        });
    });

    it('drops unknown and duplicate persisted destinations before ordering', () => {
        const preferences = normalizeSidebarPreferences(items, {
            pinnedRoutes: ['/three', '/missing', '/one', '/three'],
        });
        expect(preferences).toEqual({ pinnedRoutes: ['/three', '/one'] });
        expect(orderSidebarItems(items, preferences.pinnedRoutes).map((item) => item.to)).toEqual(['/three', '/one']);
    });

    it('opens a compact application access menu without configuration controls', async () => {
        pluginState.settings = { pinnedRoutes: ['/vault'] };
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });

        await act(async () => {
            root.render(<MemoryRouter><AppSidebar /></MemoryRouter>);
        });
        const trigger = container.querySelector('[aria-label="More applications"]');
        const navigation = container.querySelector('.app-sidebar__nav');
        expect(navigation.lastElementChild).toBe(trigger);
        await act(async () => trigger.click());

        const quickAccess = container.querySelector('[role="menu"]');
        expect(quickAccess).not.toBeNull();
        expect(quickAccess.querySelectorAll('[role="menuitem"]')).toHaveLength(1);
        expect(quickAccess.querySelector('[href="/@principal/graph"]')).not.toBeNull();
        expect(quickAccess.querySelector('[href="/@principal/knowledge"]')).toBeNull();
        expect(quickAccess.querySelector('input')).toBeNull();
        expect(quickAccess.querySelector('[aria-pressed]')).toBeNull();
    });

    it('hides the quick-access trigger when every visible application is pinned', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });

        await act(async () => {
            root.render(<MemoryRouter><AppSidebar /></MemoryRouter>);
        });

        expect(container.querySelector('[aria-label="More applications"]')).toBeNull();
    });
});
