import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    InstalledPluginsResponse,
    PluginCatalogResponse,
    PluginPermissionsCatalog,
    PluginRegistryUrlResponse,
    PluginTrustedKeysResponse,
} from '../shared/api/plugins';
import { notifyError } from '../lib/notifyError';
import { PluginsSettings } from './PluginsSettings';

const pluginState = vi.hoisted(() => ({
    enabled: new Set<string>(),
    getPluginSettings: vi.fn<(id: string) => unknown>(),
    reload: vi.fn<() => Promise<unknown>>(),
    setPluginEnabled: vi.fn<(id: string, enabled: boolean, options?: Readonly<Record<string, boolean>>) => Promise<unknown>>(),
    setPluginSettings: vi.fn<(id: string, patch: Readonly<Record<string, unknown>>) => Promise<void>>(),
}));
const fetchVaultTables = vi.hoisted(() => vi.fn<() => Promise<[]>>());
const reloadPlugins = vi.hoisted(() => vi.fn<() => Promise<void>>());
const pluginRuntimeApi = vi.hoisted(() => ({
    exportPluginPackage: vi.fn<(id: string) => Promise<Blob>>(),
    uploadPluginZip: vi.fn<(file: File) => Promise<void>>(),
}));
const pluginApi = vi.hoisted(() => ({
    addPluginTrustedKey: vi.fn<(input: Readonly<Record<string, unknown>>) => Promise<void>>(),
    createPluginLlmWikiBrain: vi.fn<(locale: string) => Promise<unknown>>(),
    fetchInstalledPlugins: vi.fn<() => Promise<InstalledPluginsResponse>>(),
    fetchPluginCatalog: vi.fn<() => Promise<PluginCatalogResponse>>(),
    fetchPluginLlmWikiConfig: vi.fn<() => Promise<unknown>>(),
    fetchPluginPermissionsCatalog: vi.fn<() => Promise<PluginPermissionsCatalog>>(),
    fetchPluginRegistryUrl: vi.fn<() => Promise<PluginRegistryUrlResponse>>(),
    fetchPluginTrustedKeys: vi.fn<() => Promise<PluginTrustedKeysResponse>>(),
    installPluginFromCatalog: vi.fn<(id: string) => Promise<void>>(),
    removePluginTrustedKey: vi.fn<(name: string) => Promise<void>>(),
    runPluginLlmWikiMaintenance: vi.fn<(semantic: boolean) => Promise<unknown>>(),
    savePluginLlmWikiConfig: vi.fn<(config: Readonly<Record<string, unknown>>) => Promise<unknown>>(),
    setPluginPermissions: vi.fn<(id: string, permissions: readonly string[]) => Promise<void>>(),
    setPluginRegistryUrl: vi.fn<(url: string) => Promise<void>>(),
    submitPluginPackage: vi.fn<(id: string) => Promise<void>>(),
    uninstallPlugin: vi.fn<(id: string) => Promise<void>>(),
}));

vi.mock('../shared/api/brain', () => ({ fetchBrainSuggestions: vi.fn() }));
vi.mock('../shared/api/plugin-runtime', () => pluginRuntimeApi);
vi.mock('../shared/api/plugins', () => pluginApi);
vi.mock('../shared/api/vaults', () => ({
    fetchVaultPagesByTable: vi.fn(),
    fetchVaultTables,
}));
vi.mock('react-i18next', () => ({
    Trans: ({ i18nKey }: { readonly i18nKey: string }) => i18nKey,
    useTranslation: () => ({
        i18n: { language: 'en' },
        t: (key: string) => key,
    }),
}));
vi.mock('../plugins/usePlugins', () => ({
    usePlugins: () => ({
        builtins: [{
            description: 'Daily notes', group: 'knowledge', icon: 'CalendarDays',
            id: 'daily-notes', name: 'Daily notes', requires: [], routes: [],
            settingsTab: 'daily-notes',
        }],
        getPluginSettings: pluginState.getPluginSettings,
        isEnabled: (id: string) => pluginState.enabled.has(id),
        reload: pluginState.reload,
        setPluginEnabled: pluginState.setPluginEnabled,
        setPluginSettings: pluginState.setPluginSettings,
    }),
}));
vi.mock('../plugins/usePluginHost', () => ({ reloadPlugins }));
vi.mock('../lib/notifyError', () => ({ notifyError: vi.fn() }));
vi.mock('./ResourcesPluginConfig', () => ({ default: () => null }));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    pluginState.enabled.clear();
    pluginState.getPluginSettings.mockReturnValue({});
    pluginState.reload.mockResolvedValue({});
    pluginState.setPluginEnabled.mockResolvedValue({});
    pluginState.setPluginSettings.mockResolvedValue(undefined);
    reloadPlugins.mockResolvedValue(undefined);
    fetchVaultTables.mockResolvedValue([]);
    pluginRuntimeApi.uploadPluginZip.mockResolvedValue(undefined);
    pluginApi.fetchInstalledPlugins.mockResolvedValue({
        plugins: [{
            granted: [],
            id: 'sample-plugin',
            manifest: {
                description: 'A sample plugin',
                id: 'sample-plugin',
                name: 'Sample plugin',
                permissions: ['vault:read'],
                version: '1.0.0',
            },
        }],
    });
    pluginApi.fetchPluginPermissionsCatalog.mockResolvedValue({ apiVersion: 2, permissions: { 'vault:read': 'Read vault' } });
    pluginApi.fetchPluginCatalog.mockResolvedValue({
        catalog: [{
            description: 'Catalog plugin', id: 'catalog-plugin', installed: false,
            name: 'Catalog plugin', signed: true, source: 'bundled', version: '2.0.0',
        }],
    });
    pluginApi.fetchPluginTrustedKeys.mockResolvedValue({ keys: [] });
    pluginApi.fetchPluginRegistryUrl.mockResolvedValue({ url: '' });
    pluginApi.installPluginFromCatalog.mockResolvedValue(undefined);
    pluginApi.setPluginPermissions.mockResolvedValue(undefined);
    pluginApi.uninstallPlugin.mockResolvedValue(undefined);
});

afterEach(() => {
    const mountedRoot = root;
    if (mountedRoot) {
        act(() => {
            mountedRoot.unmount();
        });
    }
    container?.remove();
    root = null;
    container = null;
    vi.clearAllMocks();
});

async function settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

async function renderSettings(): Promise<HTMLDivElement> {
    const nextContainer = document.createElement('div');
    document.body.appendChild(nextContainer);
    container = nextContainer;
    root = createRoot(nextContainer);
    await act(async () => {
        root?.render(<PluginsSettings />);
        await settle();
    });
    return nextContainer;
}

function buttonByText(parent: ParentNode, text: string): HTMLButtonElement {
    const button = [...parent.querySelectorAll('button')].find((candidate) => candidate.textContent.includes(text));
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${text}`);
    return button;
}

function buttonByExactText(parent: ParentNode, text: string): HTMLButtonElement {
    const button = [...parent.querySelectorAll('button')].find((candidate) => candidate.textContent.trim() === text);
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing exact button: ${text}`);
    return button;
}

async function click(button: HTMLButtonElement): Promise<void> {
    await act(async () => {
        button.click();
        await settle();
    });
}

describe('PluginsSettings lifecycle and marketplace flows', () => {
    it('locks a lifecycle switch and reports a failed request', async () => {
        let rejectRequest: ((reason: unknown) => void) | null = null;
        pluginState.setPluginEnabled.mockImplementation(() => new Promise((_resolve, reject) => {
            rejectRequest = reject;
        }));
        const view = await renderSettings();
        const toggle = view.querySelector('[role="switch"]');
        if (!(toggle instanceof HTMLButtonElement)) throw new Error('Missing lifecycle switch');

        act(() => {
            toggle.click();
        });
        expect(toggle.disabled).toBe(true);
        await act(async () => {
            rejectRequest?.(new Error('backend unavailable'));
            await settle();
        });
        expect(toggle.disabled).toBe(false);
        const notificationCall = vi.mocked(notifyError).mock.calls.at(0);
        expect(notificationCall?.[0]).toBe('plugin-lifecycle');
        expect(notificationCall?.[1]).toBeInstanceOf(Error);
        expect(notificationCall?.[2]).toBe('settings.plugins.lifecycle_error');
    });

    it('confirms dependency-aware activation with the exact lifecycle options', async () => {
        pluginState.setPluginEnabled
            .mockRejectedValueOnce({ response: { data: { detail: {
                code: 'plugin_dependency_confirmation_required', disable: [], enable: ['ai-platform'],
            } }, status: 409 } })
            .mockResolvedValueOnce({});
        const view = await renderSettings();
        const toggle = view.querySelector('[role="switch"]');
        if (!(toggle instanceof HTMLButtonElement)) throw new Error('Missing lifecycle switch');
        await click(toggle);
        await click(buttonByText(view, 'settings.plugins.dependency_confirm_action'));
        expect(pluginState.setPluginEnabled.mock.calls).toEqual([
            ['daily-notes', true],
            ['daily-notes', true, { confirmDependencies: true, confirmDisable: false }],
        ]);
    });

    it('updates declared permissions and uninstalls the selected plugin', async () => {
        const view = await renderSettings();
        const permission = view.querySelector('input[type="checkbox"]');
        if (!(permission instanceof HTMLInputElement)) throw new Error('Missing permission checkbox');
        await act(async () => {
            permission.click();
            await settle();
        });
        expect(pluginApi.setPluginPermissions).toHaveBeenCalledWith('sample-plugin', ['vault:read']);
        const uninstall = view.querySelector('button[title="settings.plugins.uninstall"]');
        if (!(uninstall instanceof HTMLButtonElement)) throw new Error('Missing uninstall action');
        await click(uninstall);
        expect(pluginApi.uninstallPlugin).toHaveBeenCalledWith('sample-plugin');
        expect(reloadPlugins).toHaveBeenCalled();
    });

    it('installs a catalog entry and opens inline built-in configuration', async () => {
        const view = await renderSettings();
        pluginState.enabled.add('daily-notes');
        await click(buttonByText(view, 'settings.plugins.catalog_tab'));
        await click(buttonByExactText(view, 'settings.plugins.install'));
        expect(pluginApi.installPluginFromCatalog).toHaveBeenCalledWith('catalog-plugin');

        await click(buttonByText(view, 'settings.plugins.installed_tab'));
        const configure = view.querySelector('button[title="settings.plugins.configure"]');
        if (!(configure instanceof HTMLButtonElement)) throw new Error('Missing configure action');
        await click(configure);
        expect(view.textContent).toContain('settings.plugins.daily_intro');
    });
});
