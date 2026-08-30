import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Runtime from '../api/plugin-runtime';
import type * as Plugins from '../api/plugins';
import { dispatchWindowEvent } from '../platform/browser-events';

const mocks = vi.hoisted(() => ({
  list: vi.fn<typeof Plugins.fetchInstalledPlugins>(),
  asset: vi.fn<typeof Runtime.fetchPluginAssetText>(),
  settings: vi.fn<typeof Runtime.fetchPluginSettings>(),
  saveSettings: vi.fn<typeof Runtime.updatePluginSettings>(),
  network: vi.fn<typeof Runtime.fetchForUiPlugin>(),
  read: vi.fn<typeof Runtime.fetchPluginHostPage>(),
  write: vi.fn<typeof Runtime.patchPluginHostPage>(),
  create: vi.fn<typeof Runtime.createPluginHostPage>(),
}));
vi.mock('../api/plugins', () => ({ fetchInstalledPlugins: mocks.list }));
vi.mock('../api/plugin-runtime', () => ({
  fetchPluginAssetText: mocks.asset, fetchPluginSettings: mocks.settings,
  updatePluginSettings: mocks.saveSettings, fetchForUiPlugin: mocks.network,
  fetchPluginHostPage: mocks.read, patchPluginHostPage: mocks.write,
  createPluginHostPage: mocks.create,
}));
vi.mock('../api/page-etag', () => ({ getCachedPageEtag: () => undefined }));
vi.mock('../api/vaults', () => ({ fetchVaultPagesByTable: vi.fn(), fetchVaultTables: vi.fn() }));

import { getContributions, loadPlugins, mountSettingsPanel, runCommand } from './host';

afterEach(async () => {
  mocks.list.mockResolvedValue({ plugins: [] });
  await loadPlugins();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function mount(granted: string[] = ['ui:command']) {
  mocks.list.mockResolvedValue({ plugins: [{
    enabled: true, granted,
    manifest: { id: 'fixture', main: 'main.js', apiVersion: 2, permissions: granted },
  }] });
  mocks.asset.mockResolvedValue('/* isolated fixture plugin */');
  await loadPlugins();
  const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="plugin:fixture"]');
  if (!iframe?.contentWindow) throw new Error('Expected live plugin frame');
  return { iframe, frameWindow: iframe.contentWindow, reply: vi.spyOn(iframe.contentWindow, 'postMessage') };
}

function send(iframe: HTMLIFrameElement, data: unknown, source: MessageEventSource | null = iframe.contentWindow) {
  dispatchWindowEvent(new MessageEvent('message', { data, source }));
}

describe('UI plugin host boundary', () => {
  it('drops old-document RPC after reparenting and renders only after panel registration', async () => {
    let resolveSettings: (value: Runtime.PluginSettingsResponse) => void = () => { throw new Error('Not initialized'); };
    const pending = new Promise<Runtime.PluginSettingsResponse>(resolve => { resolveSettings = resolve; });
    mocks.settings.mockReturnValue(pending);
    const { iframe, reply: originalReply } = await mount(['ui:settings', 'settings']);
    send(iframe, { __gnosi: true, type: 'host-call', id: 'c1', method: 'settings.get' });
    const target = document.createElement('div'); document.body.append(target);
    const restore = mountSettingsPanel('fixture', 'appearance', target);
    if (!iframe.contentWindow) throw new Error('Expected moved iframe');
    const reply = vi.spyOn(iframe.contentWindow, 'postMessage');
    resolveSettings({ settings: { stale: true } });
    await pending; await Promise.resolve(); await Promise.resolve();
    expect(originalReply).not.toHaveBeenCalled(); expect(reply).not.toHaveBeenCalled();
    const registration = { __gnosi: true, type: 'register-settings-panel', id: 'appearance' };
    send(iframe, registration, window);
    expect(reply).not.toHaveBeenCalled();
    send(iframe, registration); send(iframe, registration);
    expect(reply).toHaveBeenCalledExactlyOnceWith({
      __gnosi_host: true, type: 'run', kind: 'settings', id: 'appearance', arg: null,
    }, '*');
    expect(mocks.settings).toHaveBeenCalledOnce();
    restore();
  });

  it('rejects foreign sources and contributions without the exact grant', async () => {
    const { iframe } = await mount();
    const command = { __gnosi: true, type: 'register-command', id: 'run', title: 'Run', icon: null };
    send(iframe, command, window); send(iframe, command, null); send(iframe, { ...command, __gnosi: false });
    expect(getContributions().commands).toEqual([]);
    send(iframe, command);
    send(iframe, { ...command, type: 'register-view' });
    send(iframe, { ...command, type: 'register-panel' });
    send(iframe, { ...command, type: 'register-settings-panel' });
    expect(getContributions()).toEqual({
      commands: [{ pluginId: 'fixture', id: 'run', title: 'Run', icon: null }],
      views: [], sidebar: [], settingsPanels: [],
    });
    send(iframe, { ...command, title: 'Updated' });
    expect(getContributions().commands).toHaveLength(1);
    expect(getContributions().commands[0]?.title).toBe('Updated');
  });

  it('preserves permission and unknown-method errors without opening an API adapter', async () => {
    const { iframe, reply } = await mount();
    send(iframe, { __gnosi: true, type: 'host-call', id: 'denied', method: 'settings.get' });
    send(iframe, { __gnosi: true, type: 'host-call', id: 'unknown', method: 'missing.method' });
    expect(reply).toHaveBeenNthCalledWith(1, {
      __gnosi_host: true, type: 'host-result', id: 'denied', ok: false, error: 'permís denegat: settings',
    }, '*');
    expect(reply).toHaveBeenNthCalledWith(2, {
      __gnosi_host: true, type: 'host-result', id: 'unknown', ok: false, error: 'mètode desconegut: missing.method',
    }, '*');
    expect(mocks.settings).not.toHaveBeenCalled(); expect(mocks.network).not.toHaveBeenCalled();
  });

  it('returns scoped settings and errors once without replaying mutations', async () => {
    const { iframe, reply } = await mount(['ui:command', 'settings']);
    mocks.settings.mockResolvedValue({ settings: { accent: 'blue' } });
    mocks.saveSettings.mockRejectedValue(new Error('not saved'));
    send(iframe, { __gnosi: true, type: 'host-call', id: 'read', method: 'settings.get', args: {} });
    send(iframe, { __gnosi: true, type: 'host-call', id: 'write', method: 'settings.set', args: { settings: { accent: 'red' } } });
    await vi.waitFor(() => { expect(reply).toHaveBeenCalledTimes(2); });
    expect(mocks.settings).toHaveBeenCalledExactlyOnceWith('fixture');
    expect(mocks.saveSettings).toHaveBeenCalledExactlyOnceWith('fixture', { accent: 'red' });
    expect(reply).toHaveBeenCalledWith({ __gnosi_host: true, type: 'host-result', id: 'read', ok: true, result: { settings: { accent: 'blue' } } }, '*');
    expect(reply).toHaveBeenCalledWith({ __gnosi_host: true, type: 'host-result', id: 'write', ok: false, error: 'not saved' }, '*');
  });

  it.each(['disable', 'replace'])('drops an in-flight reply after %s and never targets a successor frame', async (operation) => {
    let resolveSettings: (value: Runtime.PluginSettingsResponse) => void = () => { throw new Error('Deferred request not initialized'); };
    const pending = new Promise<Runtime.PluginSettingsResponse>(resolve => { resolveSettings = resolve; });
    mocks.settings.mockReturnValue(pending);
    const original = await mount(['ui:command', 'settings']);
    send(original.iframe, { __gnosi: true, type: 'host-call', id: 'pending', method: 'settings.get' });
    expect(mocks.settings).toHaveBeenCalledOnce();
    if (operation === 'disable') mocks.list.mockResolvedValue({ plugins: [] });
    await loadPlugins();
    expect(original.iframe.isConnected).toBe(false);
    resolveSettings({ settings: { late: true } });
    await pending; await Promise.resolve(); await Promise.resolve();
    expect(original.reply).not.toHaveBeenCalled();
    send(original.iframe, { __gnosi: true, type: 'register-command', id: 'late' }, original.frameWindow);
    expect(getContributions().commands).toEqual([]);
    const replacement = document.querySelector<HTMLIFrameElement>('iframe');
    if (operation === 'replace') {
      expect(replacement).not.toBe(original.iframe);
      if (!replacement?.contentWindow) throw new Error('Expected replacement frame');
      const post = vi.spyOn(replacement.contentWindow, 'postMessage');
      send(replacement, { __gnosi: true, type: 'register-command', id: 'new', title: 'New' });
      runCommand('fixture', 'new', { exact: true });
      expect(getContributions().commands).toHaveLength(1);
      expect(post).toHaveBeenCalledExactlyOnceWith({ __gnosi_host: true, type: 'run', kind: 'cmd', id: 'new', arg: { exact: true } }, '*');
    } else {
      expect(replacement).toBeNull(); runCommand('fixture', 'new'); expect(original.reply).not.toHaveBeenCalled();
    }
  });
});
