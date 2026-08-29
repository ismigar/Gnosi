import { afterEach, describe, expect, it, vi } from 'vitest';

const {
    fetchInstalledPlugins,
    fetchPluginAssetText,
    fetchPluginSettings,
    updatePluginSettings,
} = vi.hoisted(() => ({
    fetchInstalledPlugins: vi.fn(),
    fetchPluginAssetText: vi.fn(),
    fetchPluginSettings: vi.fn(),
    updatePluginSettings: vi.fn(),
}));

vi.mock('../shared/api/page-etag', () => ({ getCachedPageEtag: vi.fn() }));
vi.mock('../shared/api/plugin-runtime', () => ({
    createPluginHostPage: vi.fn(),
    fetchForUiPlugin: vi.fn(),
    fetchPluginAssetText,
    fetchPluginHostPage: vi.fn(),
    fetchPluginSettings,
    patchPluginHostPage: vi.fn(),
    updatePluginSettings,
}));
vi.mock('../shared/api/plugins', () => ({ fetchInstalledPlugins }));
vi.mock('../shared/api/vaults', () => ({
    fetchVaultPagesByTable: vi.fn(),
    fetchVaultTables: vi.fn(),
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
        fetchInstalledPlugins.mockImplementation(() => Promise.resolve({
            plugins: enabled
                ? [{ manifest, enabled: true, granted: ['settings', 'ui:settings'] }]
                : [{ manifest, enabled: false, granted: ['settings', 'ui:settings'] }],
        }));
        fetchPluginAssetText.mockResolvedValue('/* plugin */');
        fetchPluginSettings.mockResolvedValue({ settings: { accent: 'violet' } });
        updatePluginSettings.mockResolvedValue({ settings: { accent: 'blue' } });

        await loadPlugins();
        const iframe = document.querySelector<HTMLIFrameElement>(
            'iframe[title="plugin:settings-example"]',
        );
        expect(iframe).not.toBeNull();
        if (!iframe) throw new Error('Expected the plugin iframe');
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

        const pluginWindow = iframe.contentWindow;
        if (!pluginWindow) throw new Error('Expected the plugin iframe window');
        const postMessage = vi.spyOn(pluginWindow, 'postMessage');
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
            expect(fetchPluginSettings).toHaveBeenCalledWith('settings-example');
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
            expect(updatePluginSettings).toHaveBeenCalledWith(
                'settings-example', { accent: 'blue' },
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
