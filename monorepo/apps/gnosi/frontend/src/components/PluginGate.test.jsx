import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { PluginRoute } from './PluginGate';

const pluginState = vi.hoisted(() => ({ enabled: false, loaded: true }));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (_key, fallback, values) => (
        String(fallback || '').replace('{{name}}', values?.name || '')
    ) }),
}));

vi.mock('../plugins/usePlugins', () => ({
    usePlugins: () => ({
        loaded: pluginState.loaded,
        isEnabled: () => pluginState.enabled,
    }),
}));

const roots = [];

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    pluginState.enabled = false;
    pluginState.loaded = true;
    while (roots.length) {
        const { root, container } = roots.pop();
        await act(async () => root.unmount());
        container.remove();
    }
});

describe('PluginRoute', () => {
    it('shows an activation surface and opens the matching plugin settings', async () => {
        const listener = vi.fn();
        window.addEventListener('open-settings', listener);
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        roots.push({ root, container });

        await act(async () => {
            root.render(<PluginRoute pluginId="mail"><div data-mail>Mail</div></PluginRoute>);
        });
        expect(container.querySelector('[data-mail]')).toBeNull();

        await act(async () => container.querySelector('button').click());
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0].detail).toEqual({ tab: 'plugins', pluginId: 'mail' });
        window.removeEventListener('open-settings', listener);
    });

    it('renders the feature immediately when enabled', async () => {
        pluginState.enabled = true;
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        roots.push({ root, container });
        await act(async () => {
            root.render(<PluginRoute pluginId="mail"><div data-mail>Mail</div></PluginRoute>);
        });
        expect(container.querySelector('[data-mail]')).not.toBeNull();
    });
});
