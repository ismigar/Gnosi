import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppSidebar, ENGINEERING_DOCUMENTATION_URL } from './AppSidebar';

const pluginState = vi.hoisted(() => ({ enabled: new Set() }));

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
        expect(container.querySelector('a[href="/vault"]')).not.toBeNull();
        expect(container.querySelector('a[href="/graph"]')).not.toBeNull();
        expect(container.querySelector('a[href="/contacts"]')).toBeNull();

        pluginState.enabled.add('contacts');
        await act(async () => {
            root.render(<MemoryRouter><AppSidebar /></MemoryRouter>);
        });
        expect(container.querySelector('a[href="/contacts"]')).not.toBeNull();
    });
});
