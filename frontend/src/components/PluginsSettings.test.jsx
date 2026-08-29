import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { PluginsSettings } from './PluginsSettings';
import { notifyError } from '../lib/notifyError';

const setPluginEnabled = vi.hoisted(() => vi.fn());
const fetchVaultTables = vi.hoisted(() => vi.fn());
const pluginRuntimeApi = vi.hoisted(() => ({
    exportPluginPackage: vi.fn(),
    uploadPluginZip: vi.fn(),
}));
const pluginApi = vi.hoisted(() => ({
    addPluginTrustedKey: vi.fn(),
    createPluginLlmWikiBrain: vi.fn(),
    fetchInstalledPlugins: vi.fn(),
    fetchPluginCatalog: vi.fn(),
    fetchPluginLlmWikiConfig: vi.fn(),
    fetchPluginPermissionsCatalog: vi.fn(),
    fetchPluginRegistryUrl: vi.fn(),
    fetchPluginTrustedKeys: vi.fn(),
    installPluginFromCatalog: vi.fn(),
    removePluginTrustedKey: vi.fn(),
    runPluginLlmWikiMaintenance: vi.fn(),
    savePluginLlmWikiConfig: vi.fn(),
    setPluginPermissions: vi.fn(),
    setPluginRegistryUrl: vi.fn(),
    submitPluginPackage: vi.fn(),
    uninstallPlugin: vi.fn(),
}));

vi.mock('../shared/api/brain', () => ({ fetchBrainSuggestions: vi.fn() }));
vi.mock('../shared/api/plugin-runtime', () => pluginRuntimeApi);
vi.mock('../shared/api/plugins', () => pluginApi);
vi.mock('../shared/api/vaults', () => ({
    fetchVaultPagesByTable: vi.fn(),
    fetchVaultTables,
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key) => key }),
    Trans: ({ i18nKey }) => i18nKey,
}));
vi.mock('../plugins/usePlugins', () => ({
    usePlugins: () => ({
        builtins: [{ id: 'daily-notes', icon: 'CalendarDays', settingsTab: 'daily-notes' }],
        isEnabled: () => false,
        setPluginEnabled,
        getPluginSettings: () => ({}),
        setPluginSettings: vi.fn(),
        reload: vi.fn(),
    }),
}));
vi.mock('../plugins/usePluginHost', () => ({ reloadPlugins: vi.fn() }));
vi.mock('../lib/notifyError', () => ({ notifyError: vi.fn() }));
vi.mock('./ResourcesPluginConfig', () => ({ default: () => null }));

let container;
let root;

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.clearAllMocks();
});

async function renderSettings() {
    fetchVaultTables.mockResolvedValue([]);
    pluginApi.fetchInstalledPlugins.mockResolvedValue({ plugins: [] });
    pluginApi.fetchPluginPermissionsCatalog.mockResolvedValue({ apiVersion: 2, permissions: {} });
    pluginApi.fetchPluginCatalog.mockResolvedValue({ catalog: [] });
    pluginApi.fetchPluginTrustedKeys.mockResolvedValue({ keys: [] });
    pluginApi.fetchPluginRegistryUrl.mockResolvedValue({ url: '' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<PluginsSettings />));
    await act(async () => {});
}

describe('PluginsSettings lifecycle switches', () => {
    it('disables the active switch and reports a failed lifecycle request', async () => {
        let rejectRequest;
        setPluginEnabled.mockImplementation(() => new Promise((_resolve, reject) => {
            rejectRequest = reject;
        }));
        await renderSettings();
        const toggle = container.querySelector('[role="switch"]');

        await act(async () => toggle.click());
        expect(toggle.disabled).toBe(true);

        await act(async () => rejectRequest(new Error('backend unavailable')));
        expect(toggle.disabled).toBe(false);
        expect(notifyError).toHaveBeenCalledWith(
            'plugin-lifecycle',
            expect.any(Error),
            'settings.plugins.lifecycle_error',
        );
    });
});
