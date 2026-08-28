import { afterEach, describe, expect, it, vi } from 'vitest';

const { axiosGet, axiosPut } = vi.hoisted(() => ({
    axiosGet: vi.fn(),
    axiosPut: vi.fn(),
}));

vi.mock('../shared/api/legacy-http', () => ({
    default: {
        get: axiosGet,
        put: axiosPut,
    },
}));

import {
    getContributions,
    loadPlugins,
    mountSettingsPanel,
} from './host';

const manifest = {
    id: 'settings-example',
    name: 'Settings example',
    version: '1.0.0',
    apiVersion: 2,
    main: 'main.js',
    permissions: ['settings', 'ui:settings'],
};

describe('third-party Settings panels', () => {
    afterEach(() => {
        document.body.replaceChildren();
        vi.clearAllMocks();
    });

    it('sandboxes registered panels, bridges settings, and removes them when disabled', async () => {
        let enabled = true;
        axiosGet.mockImplementation(async (url) => {
            if (url.endsWith('/installed')) {
                return {
                    data: {
                        plugins: enabled
                            ? [{ manifest, enabled: true, granted: ['settings', 'ui:settings'] }]
                            : [{ manifest, enabled: false, granted: ['settings', 'ui:settings'] }],
                    },
                };
            }
            if (url.endsWith('/asset/main.js')) return { data: '/* plugin */' };
            if (url.endsWith('/settings')) return { data: { settings: { accent: 'violet' } } };
            throw new Error(`Unexpected GET ${url}`);
        });
        axiosPut.mockResolvedValue({ data: { settings: { accent: 'blue' } } });

        await loadPlugins();
        const iframe = document.querySelector('iframe[title="plugin:settings-example"]');
        expect(iframe).not.toBeNull();
        expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
        expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');

        window.dispatchEvent(new MessageEvent('message', {
            source: iframe.contentWindow,
            data: {
                __gnosi: true,
                type: 'register-settings-panel',
                id: 'appearance',
                title: 'Appearance',
                height: 360,
            },
        }));
        expect(getContributions().settingsPanels).toEqual([{
            pluginId: 'settings-example',
            id: 'appearance',
            title: 'Appearance',
            height: 360,
        }]);

        const target = document.createElement('div');
        document.body.appendChild(target);
        const restore = mountSettingsPanel('settings-example', 'appearance', target, 360);
        expect(target.querySelector('iframe')).toBe(iframe);
        restore();
        expect(document.body.contains(iframe)).toBe(true);

        const postMessage = vi.spyOn(iframe.contentWindow, 'postMessage');
        window.dispatchEvent(new MessageEvent('message', {
            source: iframe.contentWindow,
            data: {
                __gnosi: true,
                type: 'host-call',
                id: 'settings-read',
                method: 'settings.get',
                args: {},
            },
        }));
        await vi.waitFor(() => {
            expect(axiosGet).toHaveBeenCalledWith('/api/vault/plugins/settings-example/settings');
            expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
                type: 'host-result',
                id: 'settings-read',
                ok: true,
            }), '*');
        });

        window.dispatchEvent(new MessageEvent('message', {
            source: iframe.contentWindow,
            data: {
                __gnosi: true,
                type: 'host-call',
                id: 'settings-write',
                method: 'settings.set',
                args: { settings: { accent: 'blue' } },
            },
        }));
        await vi.waitFor(() => {
            expect(axiosPut).toHaveBeenCalledWith(
                '/api/vault/plugins/settings-example/settings',
                { settings: { accent: 'blue' } },
            );
            expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
                type: 'host-result',
                id: 'settings-write',
                ok: true,
            }), '*');
        });

        enabled = false;
        await loadPlugins();
        expect(getContributions().settingsPanels).toEqual([]);
        expect(document.body.contains(iframe)).toBe(false);
    });
});
