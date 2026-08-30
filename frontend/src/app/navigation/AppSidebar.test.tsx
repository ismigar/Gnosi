import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppSidebar, ENGINEERING_DOCUMENTATION_URL } from './AppSidebar';
import { normalizeSidebarPreferences, orderSidebarItems } from '../../lib/appSidebarNavigation';
import { storageSet } from '../../shared/api/vault-context';
import { emitAppEvent } from '../../shared/platform/app-events';

interface PluginTestState {
    enabled: Set<string>;
    settings: { pinnedRoutes?: string[] };
}

const pluginState = vi.hoisted<PluginTestState>(() => ({
    enabled: new Set<string>(),
    settings: {},
}));
const systemApi = vi.hoisted(() => ({ fetchSystemHealth: vi.fn() }));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback || key,
    }),
}));

vi.mock('../../context/auth-context', () => ({
    useAuth: () => ({ user: null, logout: vi.fn() }),
}));

vi.mock('../../lib/toast', () => ({
    toast: { success: vi.fn() },
}));

vi.mock('../../shared/api/system', () => ({
    fetchSystemHealth: systemApi.fetchSystemHealth,
}));

vi.mock('../../plugins/usePlugins', () => ({
    usePlugins: () => ({
        isEnabled: (pluginId: string) => pluginState.enabled.has(pluginId),
        getPluginSettings: () => pluginState.settings,
        setPluginSettings: vi.fn(),
    }),
}));

vi.mock('../../components/Navigation/WorkspaceSwitcher', () => ({
    WorkspaceSwitcher: () => null,
}));

vi.mock('../../components/VaultMenu', () => ({
    default: () => null,
}));

vi.mock('../../components/GlobalSettingsModal', () => ({
    GlobalSettingsModal: () => <div data-testid="settings-modal" />,
}));

interface MountedRoot {
    readonly container: HTMLDivElement;
    readonly root: Root;
}

const mountedRoots: MountedRoot[] = [];
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};

beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});


async function renderSidebar(root: Root): Promise<void> {
    await act(async () => {
        root.render(<MemoryRouter><AppSidebar /></MemoryRouter>);
        await Promise.resolve();
    });
}


beforeEach(() => {
    pluginState.enabled.clear();
    pluginState.settings = {};
    systemApi.fetchSystemHealth.mockResolvedValue({ gnosi_mode: 'personal' });
    storageSet('gnosi_active_vault_slug', 'principal');
});

afterEach(async () => {
    vi.restoreAllMocks();
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) continue;
        const { root, container } = mounted;
        await act(async () => {
            root.unmount();
            await Promise.resolve();
        });
        container.remove();
    }
});

describe('AppSidebar documentation access', () => {
    it('opens the canonical engineering portal in a separate browser context', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });

        await renderSidebar(root);

        const link = container.querySelector(`a[href="${ENGINEERING_DOCUMENTATION_URL}"]`);
        expect(link).not.toBeNull();
        expect(link?.getAttribute('target')).toBe('_blank');
        expect(link?.getAttribute('rel')).toContain('noopener');
        expect(link?.getAttribute('aria-label')).toBe('Engineering documentation');
    });

    it('opens settings through the typed command-palette event bridge', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });
        await renderSidebar(root);

        await act(async () => {
            emitAppEvent('gnosi:open-settings');
            await Promise.resolve();
        });

        expect(container.querySelector('[data-testid="settings-modal"]')).not.toBeNull();
    });

    it('keeps optional navigation hidden until its plugin is enabled', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });

        await renderSidebar(root);
        expect(container.querySelector('a[href="/@principal/knowledge"]')).not.toBeNull();
        expect(container.querySelector('a[href="/@principal/graph"]')).not.toBeNull();
        expect(container.querySelector('a[href="/@principal/contacts"]')).toBeNull();

        pluginState.enabled.add('contacts');
        await renderSidebar(root);
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

        await renderSidebar(root);
        const trigger = container.querySelector('[aria-label="More applications"]');
        const navigation = container.querySelector('.app-sidebar__nav');
        expect(navigation?.lastElementChild).toBe(trigger);
        if (!(trigger instanceof HTMLElement)) throw new Error('Quick access trigger not rendered');
        act(() => {
            trigger.click();
        });

        const quickAccess = container.querySelector('[role="menu"]');
        expect(quickAccess).not.toBeNull();
        expect(quickAccess?.querySelectorAll('[role="menuitem"]')).toHaveLength(1);
        expect(quickAccess?.querySelector('[href="/@principal/graph"]')).not.toBeNull();
        expect(quickAccess?.querySelector('[href="/@principal/knowledge"]')).toBeNull();
        expect(quickAccess?.querySelector('input')).toBeNull();
        expect(quickAccess?.querySelector('[aria-pressed]')).toBeNull();
    });

    it('hides the quick-access trigger when every visible application is pinned', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });

        await renderSidebar(root);

        expect(container.querySelector('[aria-label="More applications"]')).toBeNull();
    });
});
