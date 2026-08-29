import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { PluginRoute } from './PluginGate';
import { subscribeAppEvent } from '../shared/platform/app-events';

const pluginState = vi.hoisted(() => ({ enabled: false, loaded: true }));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (_key: string, fallback: string, values?: { readonly name?: string }) => (
        fallback.replace('{{name}}', values?.name || '')
    ) }),
}));

vi.mock('../plugins/usePlugins', () => ({
    usePlugins: () => ({
        loaded: pluginState.loaded,
        isEnabled: () => pluginState.enabled,
    }),
}));

interface MountedRoot {
    readonly container: HTMLDivElement;
    readonly root: Root;
}

const roots: MountedRoot[] = [];
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};

beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    pluginState.enabled = false;
    pluginState.loaded = true;
    while (roots.length) {
        const mounted = roots.pop();
        if (!mounted) break;
        const { root, container } = mounted;
        act(() => {
            root.unmount();
        });
        container.remove();
    }
});

describe('PluginRoute', () => {
    it('shows an activation surface and opens the matching plugin settings', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeAppEvent('open-settings', listener);
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        roots.push({ root, container });

        act(() => {
            root.render(<PluginRoute pluginId="mail"><div data-mail>Mail</div></PluginRoute>);
        });
        expect(container.querySelector('[data-mail]')).toBeNull();

        const button = container.querySelector('button');
        if (!(button instanceof HTMLButtonElement)) {
            throw new Error('Expected the plugin settings button.');
        }
        act(() => {
            button.click();
        });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0]?.[0]).toEqual({ tab: 'plugins', pluginId: 'mail' });
        unsubscribe();
    });

    it('renders the feature immediately when enabled', () => {
        pluginState.enabled = true;
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        roots.push({ root, container });
        act(() => {
            root.render(<PluginRoute pluginId="mail"><div data-mail>Mail</div></PluginRoute>);
        });
        expect(container.querySelector('[data-mail]')).not.toBeNull();
    });
});
